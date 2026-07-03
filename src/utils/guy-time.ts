// Galactic Union time (see the wiki's "Time" article / ff-time.wikitext).
//
// 1 GUY = 32 semesters = 1440 equinoxes; 1 semester = 45 equinoxes (5 weeks
// of 9). 1 GUY = 288/73 Earth years, which at 365 days/year is *exactly*
// 1440 days — so 1 equinox = 1 Earth day = 86,400,000 ms, and the calendar
// has no leap anything. Conversion is exact integer arithmetic.
//
// In-universe dates are stored as an integer: equinoxes since the GUY epoch
// (1-1-0 GUY = 13 March 1853 BCE 10:54:28.150 UTC — far outside every DB
// datetime type, hence this representation). ±2^31 equinoxes covers about
// ±1.49 million GUY.
//
// Notation follows dd-mm-yyyy order: equinox-semester-year, "4-2-3022 GUY".
// Negative years mark dates before the Galactic Union's founding.

export const EQUINOXES_PER_WEEK = 9;
export const EQUINOXES_PER_SEMESTER = 45;
export const SEMESTERS_PER_GUY = 32;
export const EQUINOXES_PER_GUY = 1440;
export const EQUINOX_MS = 86_400_000;

// 13 March 1853 BCE = astronomical year -1852 (proleptic Gregorian, UTC)
export const GUY_EPOCH_MS = Date.UTC(-1852, 2, 13, 10, 54, 28, 150);

export const GUY_WEEKDAYS = ['Turkal', 'Rezet', 'Ever', 'Rimbo', 'Overt', 'Elena', 'Mono', 'Eflo', 'Rinns'];

export interface GuyDate {
    year: number;
    /** 1–32 */
    semester: number;
    /** 1–45 */
    equinox: number;
}

const floorDiv = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;

export function equinoxesToGuyDate(equinoxes: number): GuyDate {
    const year = floorDiv(equinoxes, EQUINOXES_PER_GUY);
    const dayOfYear = mod(equinoxes, EQUINOXES_PER_GUY); // 0–1439
    return {
        year,
        semester: floorDiv(dayOfYear, EQUINOXES_PER_SEMESTER) + 1,
        equinox: mod(dayOfYear, EQUINOXES_PER_SEMESTER) + 1,
    };
}

export function guyDateToEquinoxes({ year, semester, equinox }: GuyDate): number {
    return year * EQUINOXES_PER_GUY + (semester - 1) * EQUINOXES_PER_SEMESTER + (equinox - 1);
}

/** "4-2-3022" (equinox-semester-year). Append " GUY" yourself where wanted. */
export function formatGuyDate(equinoxes: number): string {
    const { year, semester, equinox } = equinoxesToGuyDate(equinoxes);
    return `${equinox}-${semester}-${year}`;
}

/**
 * Parses "4-2-3022" / "4-2--142" / "4-2-3022 GUY" into an equinox count.
 * Returns null when malformed or out of calendar range.
 */
export function parseGuyDate(input: string): number | null {
    const match = input.trim().match(/^(\d{1,2})-(\d{1,2})-(-?\d+)(?:\s*GUY)?$/i);
    if (!match) return null;
    const equinox = parseInt(match[1]);
    const semester = parseInt(match[2]);
    const year = parseInt(match[3]);
    if (equinox < 1 || equinox > EQUINOXES_PER_SEMESTER) return null;
    if (semester < 1 || semester > SEMESTERS_PER_GUY) return null;
    return guyDateToEquinoxes({ year, semester, equinox });
}

/** Day-of-week name; 1-1-0 GUY was a Turkal. */
export function guyWeekday(equinoxes: number): string {
    return GUY_WEEKDAYS[mod(equinoxes, EQUINOXES_PER_WEEK)];
}

// ---------- Earth (proleptic Gregorian) conversion ----------

export function guyToEarthDate(equinoxes: number): Date {
    return new Date(GUY_EPOCH_MS + equinoxes * EQUINOX_MS);
}

export function earthDateToGuy(date: Date): number {
    return floorDiv(date.getTime() - GUY_EPOCH_MS, EQUINOX_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13 Mar 1853 BCE" / "9 Jun 10062 CE" — works far outside Intl's comfort zone. */
export function formatEarthDate(date: Date): string {
    const year = date.getUTCFullYear();
    const era = year <= 0 ? `${1 - year} BCE` : `${year} CE`;
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${era}`;
}

/**
 * API input → stored equinox count. Accepts GUY notation ("4-2-3022"),
 * a raw equinox integer, or null (clear). Throws on malformed input.
 */
export function guyInputToEquinoxes(input: string | number | null): number | null {
    if (input === null) return null;
    if (typeof input === "number" && Number.isInteger(input)) return input;
    if (typeof input === "string") {
        const parsed = parseGuyDate(input);
        if (parsed !== null) return parsed;
    }
    throw new Error("Invalid GUY date — use equinox-semester-year notation, e.g. 4-2-3022");
}
