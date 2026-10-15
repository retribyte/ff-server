// Resolves booru.vortox.space post IDs to image URLs for user avatars.
//
// The booru runs Shimmie2; we use its Danbooru-compatible API
// (`/api/danbooru/find_posts?id=N`), which answers with XML like
//   <posts count='1' offset='0'><tag id='12' file_url='...' preview_url='...' file_name='...' ...></tag></posts>
// (Shimmie names each post element `tag` and single-quotes its attributes;
// both are accepted here, along with Danbooru's own `<post id="...">`.)
// BOORU_URL overrides the base URL. Shimmie has no API keys; if the booru
// ever stops serving posts anonymously, set BOORU_USER / BOORU_PASSWORD and
// they go along as HTTP Basic auth, which its Danbooru API accepts.
// The booru sits behind a Cloudflare bot challenge; IMAGE_KEY, sent as the
// `x-image-key` header, is what Cloudflare lets through.

const BOORU_URL = (process.env.BOORU_URL ?? "https://booru.vortox.space").replace(/\/+$/, "");
const BOORU_USER = process.env.BOORU_USER;
const BOORU_PASSWORD = process.env.BOORU_PASSWORD;
const IMAGE_KEY = process.env.IMAGE_KEY;
const TIMEOUT_MS = 8000;
const ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif"]);

export interface BooruPost {
    id: number;
    imageUrl: string;
    previewUrl: string | null;
}

/** The booru couldn't be reached or answered with something other than its API. */
export class BooruUnavailableError extends Error {
    constructor(message = "The booru is not answering") {
        super(message);
        this.name = "BooruUnavailableError";
    }
}

function decodeEntities(value: string): string {
    return value
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function parseAttributes(tag: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g)) {
        attributes[match[1]] = decodeEntities(match[2] ?? match[3]);
    }
    return attributes;
}

function absolute(url: string): string {
    return new URL(url, `${BOORU_URL}/`).toString();
}

function extensionOf(attributes: Record<string, string>): string | null {
    const source = attributes.file_name || attributes.file_url || "";
    const match = /\.([a-z0-9]+)(?:$|[?#])/i.exec(source);
    return match ? match[1].toLowerCase() : null;
}

function booruHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (IMAGE_KEY) headers["x-image-key"] = IMAGE_KEY;
    if (BOORU_USER && BOORU_PASSWORD) {
        headers.Authorization = `Basic ${Buffer.from(`${BOORU_USER}:${BOORU_PASSWORD}`).toString("base64")}`;
    }
    return headers;
}

/**
 * Looks up a booru post. Returns null when no such post exists; throws
 * BooruUnavailableError when the booru can't be queried, and Error when the
 * post isn't a still image.
 */
async function getBooruPost(id: number): Promise<BooruPost | null> {
    const url = new URL(`${BOORU_URL}/api/danbooru/find_posts`);
    url.searchParams.set("id", String(id));
    const headers = booruHeaders();

    // The booru intermittently stalls or errors and then answers fine on the
    // next try, so give it one retry before reporting it unavailable.
    let body = "";
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
            body = await response.text();
            // Anything that isn't the API's XML (a bot challenge, an error
            // page) means we never reached Shimmie.
            if (response.ok && body.includes("<posts")) break;
            console.warn(`booru: post ${id} attempt ${attempt} got HTTP ${response.status}: ${body.slice(0, 200).replace(/\s+/g, " ")}`);
        } catch (err) {
            // fetch's own message is just "fetch failed"; the reason (DNS,
            // refused, reset, TLS) is on its cause.
            const detail = err instanceof Error && err.cause instanceof Error ? ` <- ${err.cause.message}` : "";
            const cause = err instanceof Error ? `${err.name}: ${err.message}${detail}` : String(err);
            console.warn(`booru: post ${id} attempt ${attempt} failed (${cause})`);
        }
        if (attempt >= ATTEMPTS) throw new BooruUnavailableError();
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }

    const tag = /<(?:post|tag)\s[^>]*>/.exec(body)?.[0];
    if (!tag) return null;
    const attributes = parseAttributes(tag);
    if (parseInt(attributes.id, 10) !== id || !attributes.file_url) return null;

    const extension = extensionOf(attributes);
    if (extension && !IMAGE_EXTENSIONS.has(extension)) {
        throw new Error(`Booru post ${id} isn't an image`);
    }

    return {
        id,
        imageUrl: absolute(attributes.file_url),
        previewUrl: attributes.preview_url ? absolute(attributes.preview_url) : null,
    };
}

// ── Image proxy ─────────────────────────────────────────────────────────
// Browsers never fetch booru images directly: the Cloudflare challenge
// would block them (IMAGE_KEY stays server-side), and the site's pixel
// avatars read pixels back from a canvas, which a cross-origin image taints.
// Shimmie's file paths are content-addressed (/_images/<md5>/...), so an
// image never changes under its URL — cache hard, here and in browsers.

const IMAGE_PATH_PREFIXES = ["/_images/", "/_thumbs/"];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;

export interface BooruImage {
    body: Buffer;
    contentType: string;
}

// Insertion-ordered Map as a small LRU (re-inserted on hit)
const imageCache = new Map<string, BooruImage>();
// One booru request per URL however many avatars ask for it at once
const imageFetches = new Map<string, Promise<BooruImage | null>>();

// Failures are remembered briefly too, so a missing image or a booru outage
// doesn't turn every page view into fresh (retried) requests against it
const MISSING_TTL_MS = 10 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 60 * 1000;
const MAX_FAILURES = 1000;
const failures = new Map<string, { until: number; unavailable: boolean }>();

function rememberFailure(key: string, unavailable: boolean) {
    if (failures.size >= MAX_FAILURES) failures.delete(failures.keys().next().value!);
    failures.set(key, { until: Date.now() + (unavailable ? UNAVAILABLE_TTL_MS : MISSING_TTL_MS), unavailable });
}
let imageCacheBytes = 0;

function cacheImage(key: string, image: BooruImage) {
    imageCache.set(key, image);
    imageCacheBytes += image.body.length;
    for (const [oldKey, old] of imageCache) {
        if (imageCacheBytes <= CACHE_MAX_BYTES) break;
        imageCache.delete(oldKey);
        imageCacheBytes -= old.body.length;
    }
}

/**
 * The image type from its leading bytes. Shimmie serves some files (e.g.
 * /_images/<md5> without a filename) with no Content-Type at all, so the
 * header alone can't tell an image from a challenge page.
 */
function sniffImageType(body: Buffer): string | null {
    const ascii = (start: number, end: number) => body.subarray(start, end).toString("latin1");
    if (body.length >= 8 && body.readUInt32BE(0) === 0x89504e47) return "image/png";
    if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
    if (ascii(0, 4) === "GIF8") return "image/gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "image/avif";
    return null;
}

/**
 * Parses a URL the site wants proxied, or null when it isn't an image on
 * our booru — the proxy must never fetch arbitrary URLs for callers.
 */
function parseBooruImageUrl(raw: string): URL | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.origin !== new URL(BOORU_URL).origin) return null;
    if (url.username || url.password) return null;
    if (!IMAGE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
    url.hash = "";
    return url;
}

/**
 * Fetches an image from the booru. Returns null when the URL isn't a booru
 * image or the booru says it doesn't exist; throws BooruUnavailableError
 * when the booru can't be reached or answers with something else.
 */
async function getBooruImage(raw: string): Promise<BooruImage | null> {
    const url = parseBooruImageUrl(raw);
    if (!url) return null;
    const key = url.toString();

    const cached = imageCache.get(key);
    if (cached) {
        imageCache.delete(key);
        imageCache.set(key, cached);
        return cached;
    }

    const failure = failures.get(key);
    if (failure && failure.until > Date.now()) {
        if (failure.unavailable) throw new BooruUnavailableError();
        return null;
    }
    failures.delete(key);

    let pending = imageFetches.get(key);
    if (!pending) {
        pending = fetchBooruImage(url)
            .then(
                (image) => {
                    if (!image) rememberFailure(key, false);
                    return image;
                },
                (err) => {
                    if (err instanceof BooruUnavailableError) rememberFailure(key, true);
                    throw err;
                }
            )
            .finally(() => imageFetches.delete(key));
        imageFetches.set(key, pending);
    }
    return pending;
}

async function fetchBooruImage(url: URL): Promise<BooruImage | null> {
    const key = url.toString();
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(url, {
                headers: booruHeaders(),
                redirect: "error",
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (response.status === 404) return null;
            const declared = response.headers.get("Content-Type") ?? "";
            const length = parseInt(response.headers.get("Content-Length") ?? "0", 10);
            if (response.ok && length <= MAX_IMAGE_BYTES) {
                const body = Buffer.from(await response.arrayBuffer());
                // Trust the bytes, not the header (which may be missing)
                const contentType = sniffImageType(body);
                if (contentType && body.length <= MAX_IMAGE_BYTES) {
                    const image = { body, contentType };
                    cacheImage(key, image);
                    return image;
                }
            }
            // A bot challenge or error page comes back as HTML, not an image
            console.warn(`booru: image ${url.pathname} attempt ${attempt} got HTTP ${response.status} (${declared || "no type"})`);
        } catch (err) {
            const detail = err instanceof Error && err.cause instanceof Error ? ` <- ${err.cause.message}` : "";
            const cause = err instanceof Error ? `${err.name}: ${err.message}${detail}` : String(err);
            console.warn(`booru: image ${url.pathname} attempt ${attempt} failed (${cause})`);
        }
        if (attempt >= ATTEMPTS) throw new BooruUnavailableError();
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
}

export default { getBooruPost, getBooruImage };
