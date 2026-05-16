import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = ["b", "i", "em", "strong", "a", "p", "br", "ul", "ol", "li"];
const ALLOWED_ATTRIBUTES = { a: ["href"] };
const ALLOWED_SCHEMES = ["http", "https"];

export function sanitizeText(input: string): string {
    return sanitizeHtml(input, {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: ALLOWED_ATTRIBUTES,
        allowedSchemesByTag: { a: ALLOWED_SCHEMES },
    });
}
