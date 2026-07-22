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
//
// NOTE: this file is kept byte-for-byte identical between ff-site
// (src/lib/guy-time.ts) and ff-server (src/utils/guy-time.ts). Edit both.

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

/**
 * "32 of 18, 3027" (equinox of semester, year) — the display form. Append
 * " GUY" yourself where wanted. Note this is *not* the inverse of
 * parseGuyDate, which reads the compact "32-18-3027" input notation.
 */
export function formatGuyDate(equinoxes: number): string {
    const { year, semester, equinox } = equinoxesToGuyDate(equinoxes);
    return `${equinox} of ${semester}, ${year}`;
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

/** Day-of-week name; 1-1-0 GUY was a Turkal. */
export function guyWeekday(equinoxes: number): string {
    return GUY_WEEKDAYS[mod(equinoxes, EQUINOXES_PER_WEEK)];
}

// ---------- Full date-time (sub-equinox units) ----------
// 1 equinox = 24 periods; 1 period = 60 unions; 1 union = 60 duons;
// 1 duon = 60 trions. A duon is exactly one second, so a trion is 1/60 s.

export const PERIOD_MS = EQUINOX_MS / 24; // 3,600,000
export const UNION_MS = PERIOD_MS / 60; //     60,000
export const DUON_MS = UNION_MS / 60; //        1,000
export const TRION_MS = DUON_MS / 60; //      16.666…

export interface GuyDateTime extends GuyDate {
    /** 0–23 */
    period: number;
    /** 0–59 */
    union: number;
    /** 0–59 */
    duon: number;
    /** 0–59 */
    trion: number;
}

const TRIONS_PER_EQUINOX = 24 * 60 * 60 * 60; // 5,184,000

export function msToGuyDateTime(msSinceGuyEpoch: number): GuyDateTime {
    let equinoxes = floorDiv(msSinceGuyEpoch, EQUINOX_MS);
    // The trion grid (16.6̄ ms) doesn't align with milliseconds — round to
    // the nearest trion and carry a full equinox if that rounds up past it.
    let totalTrions = Math.round(mod(msSinceGuyEpoch, EQUINOX_MS) * (60 / DUON_MS));
    if (totalTrions >= TRIONS_PER_EQUINOX) {
        totalTrions -= TRIONS_PER_EQUINOX;
        equinoxes += 1;
    }
    return {
        ...equinoxesToGuyDate(equinoxes),
        period: Math.floor(totalTrions / 216_000),
        union: Math.floor(totalTrions / 3_600) % 60,
        duon: Math.floor(totalTrions / 60) % 60,
        trion: totalTrions % 60,
    };
}

export function guyDateTimeToMs(g: GuyDateTime): number {
    const totalTrions = ((g.period * 60 + g.union) * 60 + g.duon) * 60 + g.trion;
    return guyDateToEquinoxes(g) * EQUINOX_MS + Math.round(totalTrions * TRION_MS);
}

/** "10:54:28.09" — period:union:duon.trion */
export function formatGuyTime(g: GuyDateTime): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(g.period)}:${p2(g.union)}:${p2(g.duon)}.${p2(g.trion)}`;
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

/** "13 Mar 1853 BCE, 10:54:28.150 UTC" */
export function formatEarthDateTime(date: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    const time = `${p2(date.getUTCHours())}:${p2(date.getUTCMinutes())}:${p2(date.getUTCSeconds())}.${String(
        date.getUTCMilliseconds()
    ).padStart(3, '0')}`;
    return `${formatEarthDate(date)}, ${time} UTC`;
}
