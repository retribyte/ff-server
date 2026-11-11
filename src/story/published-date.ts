// Story.publishedDate: the real-world date a story was published. A calendar
// date with no time, stored as midnight UTC, so clients should read it back as
// the first 10 characters of the ISO string (never format it in local time:
// midnight UTC is the previous evening in the Americas).

/**
 * undefined: not sent (leave the stored date alone). null or "": clear it.
 * "YYYY-MM-DD" (or a full ISO string starting with one, as the API returns it):
 * that day at 00:00 UTC. Anything else, including a day that doesn't exist
 * (2026-02-30), throws a message fit for a 400.
 */
export function parsePublishedDate(value: unknown): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (typeof value !== "string") throw new Error("publishedDate must be a date (YYYY-MM-DD) or null");
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/.exec(value.trim());
    if (!match) throw new Error("publishedDate must be a date (YYYY-MM-DD) or null");
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new Error(`publishedDate '${value}' is not a real date`);
    }
    return date;
}
