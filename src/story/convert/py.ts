// Python string semantics the story converters depend on. The converters are
// ports of ff-site/archive-to-markdown/story-{docx-to-md,md-to-api}.py and
// are tested byte-for-byte against that pipeline's output, so whitespace,
// line splitting and slicing have to behave the way Python's do. JavaScript's
// `\s`, `.trim()`, `.` and UTF-16 `.length` all differ in small ways.

/** Python's str.isspace() set (what str.split()/strip() and re's `\s` use). */
export const WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS_RUN = new RegExp(`[${WS}]+`, "g");
const LEADING = new RegExp(`^[${WS}]+`);
const TRAILING = new RegExp(`[${WS}]+$`);

/** str.split() with no argument: split on runs of whitespace, no empty pieces. */
export function split(text: string): string[] {
    return text.split(WS_RUN).filter((piece) => piece !== "");
}

/** " ".join(text.split()) */
export function collapse(text: string): string {
    return split(text).join(" ");
}

export function strip(text: string): string {
    return text.replace(LEADING, "").replace(TRAILING, "");
}

export function lstrip(text: string): string {
    return text.replace(LEADING, "");
}

export function rstrip(text: string): string {
    return text.replace(TRAILING, "");
}

/** str.strip(chars) */
export function stripChars(text: string, chars: string): string {
    let start = 0;
    let end = text.length;
    while (start < end && chars.includes(text[start])) start++;
    while (end > start && chars.includes(text[end - 1])) end--;
    return text.slice(start, end);
}

/** str.splitlines(): every Python line boundary, no trailing empty line. */
export function splitlines(text: string): string[] {
    const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
}

/** Length in code points, like Python's len(). */
export function len(text: string): number {
    return Array.from(text).length;
}

/** text[:n] in code points. */
export function head(text: string, n: number): string {
    return Array.from(text).slice(0, n).join("");
}

/** Any character for which Python's str.isalnum() is true. */
export function hasAlnum(text: string): boolean {
    return /[\p{L}\p{N}]/u.test(text);
}

/** repr() of a str, for warnings that quote the document. */
export function repr(text: string): string {
    const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
    let out = quote;
    for (const ch of text) {
        const code = ch.codePointAt(0)!;
        if (ch === "\\") out += "\\\\";
        else if (ch === quote) out += "\\" + ch;
        else if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else if (ch !== " " && /[\p{C}\p{Z}]/u.test(ch)) {
            out += code <= 0xff ? `\\x${code.toString(16).padStart(2, "0")}`
                : code <= 0xffff ? `\\u${code.toString(16).padStart(4, "0")}`
                : `\\U${code.toString(16).padStart(8, "0")}`;
        } else out += ch;
    }
    return out + quote;
}
