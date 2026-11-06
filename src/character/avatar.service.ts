import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { decodeAvatarDataUrl, isDataUrl } from "../utils/avatar-image.js";

/**
 * Turns an `image` value from a character or persona write into what gets
 * stored: an uploaded data: URL is validated and saved, and its avatar path
 * returned (throwing AvatarImageError if it breaks the rules). Anything else is
 * an existing path or URL and passes through. Being on the write itself, an
 * upload needs exactly the permission to edit that record.
 */
export async function storeAvatarUpload<T extends string | null | undefined>(image: T): Promise<T | string> {
    if (typeof image !== "string" || !isDataUrl(image)) return image;
    const png = decodeAvatarDataUrl(image);
    const sha256 = createHash("sha256").update(png).digest("hex");
    await prisma.avatarImage.createMany({ data: [{ sha256, data: Uint8Array.from(png) }], skipDuplicates: true });
    return `/api/avatars/${sha256}.png`;
}

export async function getAvatarImage(sha256: string): Promise<Buffer | null> {
    const avatar = await prisma.avatarImage.findUnique({ where: { sha256 } });
    return avatar && Buffer.from(avatar.data);
}
