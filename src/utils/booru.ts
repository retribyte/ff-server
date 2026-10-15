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

/**
 * Looks up a booru post. Returns null when no such post exists; throws
 * BooruUnavailableError when the booru can't be queried, and Error when the
 * post isn't a still image.
 */
async function getBooruPost(id: number): Promise<BooruPost | null> {
    const url = new URL(`${BOORU_URL}/api/danbooru/find_posts`);
    url.searchParams.set("id", String(id));
    const headers: Record<string, string> = {};
    if (IMAGE_KEY) headers["x-image-key"] = IMAGE_KEY;
    if (BOORU_USER && BOORU_PASSWORD) {
        headers.Authorization = `Basic ${Buffer.from(`${BOORU_USER}:${BOORU_PASSWORD}`).toString("base64")}`;
    }

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

export default { getBooruPost };
