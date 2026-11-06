// Validation for uploaded avatars, which arrive as data: URLs in a character's
// or persona's `image` field. This reads the PNG container without decoding the
// pixels: native image libraries don't run on the FreeBSD host, and a browser
// that can't decode a file just shows the letter tile.

/** Sprites are 14x14; PixelAvatar adds its 1px outline around that when drawing. */
export const AVATAR_MAX_SIDE = 14;
/** Generous for a 14x14 PNG, leaving room for an editor's embedded color profile. */
export const AVATAR_MAX_BYTES = 16 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

/** The upload breaks a rule; the message is shown to the uploader. */
export class AvatarImageError extends Error {}

export function isDataUrl(image: string): boolean {
    return /^\s*data:/i.test(image);
}

/** The PNG's bytes, or an AvatarImageError saying what's wrong with the upload. */
export function decodeAvatarDataUrl(dataUrl: string): Buffer {
    const base64 = DATA_URL.exec(dataUrl.trim())?.[1];
    if (!base64) throw new AvatarImageError("Avatars must be PNG files");
    const png = Buffer.from(base64, "base64");
    if (png.length > AVATAR_MAX_BYTES) {
        throw new AvatarImageError(`Avatars can be at most ${AVATAR_MAX_BYTES / 1024} KB`);
    }
    if (!hasPngStructure(png)) throw new AvatarImageError("That file isn't a valid PNG");
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width === 0 || height === 0 || width > AVATAR_MAX_SIDE || height > AVATAR_MAX_SIDE) {
        throw new AvatarImageError(
            `Avatars can be at most ${AVATAR_MAX_SIDE}x${AVATAR_MAX_SIDE} pixels (this one is ${width}x${height})`
        );
    }
    return png;
}

// Signature, then chunks from IHDR through IDAT to an IEND that ends the file
function hasPngStructure(png: Buffer): boolean {
    if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;
    let offset = PNG_SIGNATURE.length;
    let hasImageData = false;
    while (offset + 12 <= png.length) {
        const length = png.readUInt32BE(offset);
        const type = png.toString("latin1", offset + 4, offset + 8);
        const next = offset + 12 + length;
        if (next > png.length) return false;
        if (offset === PNG_SIGNATURE.length && (type !== "IHDR" || length !== 13)) return false;
        if (type === "IDAT") hasImageData = true;
        if (type === "IEND") return hasImageData && next === png.length;
        offset = next;
    }
    return false;
}
