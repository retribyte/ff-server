import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { AVATAR_MAX_BYTES, AvatarImageError, decodeAvatarDataUrl, isDataUrl } from "../src/utils/avatar-image.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The validator doesn't check CRCs, so these stay zero
function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

function png(width: number, height: number, extra: Buffer = Buffer.alloc(0)): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), extra, chunk("IDAT", deflateSync(Buffer.alloc(1))), chunk("IEND")]);
}

const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;

function rejects(url: string, message: RegExp) {
    assert.throws(() => decodeAvatarDataUrl(url), (error: Error) => error instanceof AvatarImageError && message.test(error.message));
}

test("accepts PNGs up to 14x14, including non-square and smaller ones", () => {
    for (const [width, height] of [[14, 14], [1, 1], [14, 7], [7, 14]]) {
        const bytes = png(width, height);
        assert.deepEqual(decodeAvatarDataUrl(dataUrl(bytes)), bytes);
    }
});

test("rejects anything over 14 pixels on either side, naming the size", () => {
    rejects(dataUrl(png(15, 14)), /at most 14x14 pixels \(this one is 15x14\)/);
    rejects(dataUrl(png(14, 15)), /this one is 14x15/);
    rejects(dataUrl(png(4294967295, 1)), /at most 14x14/);
});

test("rejects zero-sized images", () => {
    rejects(dataUrl(png(0, 14)), /at most 14x14/);
});

test("rejects other image types and malformed data URLs", () => {
    rejects("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", /must be PNG/);
    rejects("data:image/gif;base64,R0lGODlhAQABAAAAACw=", /must be PNG/);
    rejects("data:image/png,not-base64", /must be PNG/);
    rejects("data:image/png;base64,", /must be PNG/);
});

test("rejects files that claim to be PNG but aren't complete ones", () => {
    const good = png(14, 14);
    rejects(dataUrl(Buffer.from("definitely not a png")), /isn't a valid PNG/);
    rejects(dataUrl(good.subarray(0, good.length - 4)), /isn't a valid PNG/); // truncated
    rejects(dataUrl(Buffer.concat([good, Buffer.from("trailing")])), /isn't a valid PNG/);
    const noImageData = Buffer.concat([SIGNATURE, good.subarray(8, 8 + 25), chunk("IEND")]);
    rejects(dataUrl(noImageData), /isn't a valid PNG/);
});

test("rejects files over the byte cap, even at a legal size", () => {
    rejects(dataUrl(png(14, 14, chunk("tEXt", Buffer.alloc(AVATAR_MAX_BYTES)))), /at most 16 KB/);
});

test("every spelling of a data: URL is treated as an upload, so none skips validation", () => {
    for (const image of ["data:image/svg+xml,x", "DATA:image/png;base64,AA==", "  data:text/html,x"]) {
        assert.equal(isDataUrl(image), true);
    }
    for (const image of ["/avatars/emmett.png", "/api/avatars/abc.png", "https://booru.vortox.space/_images/x.png"]) {
        assert.equal(isDataUrl(image), false);
    }
});
