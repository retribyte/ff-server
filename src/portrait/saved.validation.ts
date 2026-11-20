import type { Prisma } from "@prisma/client";
import { decodePngDataUrl } from "../utils/avatar-image.js";

// The input rules for saved portraits (table `portraits`), apart from the service so
// they can be tested without a database (CI has none).

/** The frame is 43x43 and grows for the few items with larger sprites. */
export const PORTRAIT_MAX_SIDE = 256;
export const PORTRAIT_MAX_BYTES = 64 * 1024;
export const RECIPE_MAX_BYTES = 32 * 1024;
export const NAME_MAX = 100;
/** Per member, so the table cannot be filled by one account. */
export const PORTRAITS_PER_USER = 300;

/** The body breaks a rule; the message is shown to the member. */
export class PortraitInputError extends Error {}

export interface PortraitInput {
    name: string;
    race: string;
    recipe: Prisma.InputJsonObject;
    image: Buffer;
}

/** A save request's body, checked. With `partial`, only the fields sent are checked and returned. */
export function parsePortrait(body: unknown, partial = false): Partial<PortraitInput> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new PortraitInputError("Send name, race, recipe and image");
    const o = body as Record<string, unknown>;
    const out: Partial<PortraitInput> = {};
    const has = (key: string) => {
        if (o[key] !== undefined) return true;
        if (!partial) throw new PortraitInputError(`${key} is required`);
        return false;
    };
    if (has("name")) {
        if (typeof o.name !== "string" || !o.name.trim() || o.name.trim().length > NAME_MAX) throw new PortraitInputError(`A portrait needs a name of at most ${NAME_MAX} characters`);
        out.name = o.name.trim();
    }
    if (has("race")) {
        if (typeof o.race !== "string" || !o.race || o.race.length > 200) throw new PortraitInputError("race must be the creator's race id");
        out.race = o.race;
    }
    if (has("recipe")) {
        const r = o.recipe as Record<string, unknown>;
        if (typeof r !== "object" || r === null || Array.isArray(r) || typeof r.species !== "string" || typeof r.v !== "number") throw new PortraitInputError("recipe must be a portrait recipe");
        if (JSON.stringify(r).length > RECIPE_MAX_BYTES) throw new PortraitInputError("That recipe is too large to keep");
        out.recipe = r as Prisma.InputJsonObject;
    }
    if (has("image")) {
        if (typeof o.image !== "string") throw new PortraitInputError("image must be a PNG data: URL");
        try {
            out.image = decodePngDataUrl(o.image, PORTRAIT_MAX_SIDE, PORTRAIT_MAX_BYTES, "Portraits");
        } catch (error) {
            throw new PortraitInputError(error instanceof Error ? error.message : "That image can't be kept");
        }
    }
    return out;
}
