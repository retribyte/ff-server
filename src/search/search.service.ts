import characterService from "../character/character.service.js";
import itemService from "../item/item.service.js";
import messageService from "../message/message.service.js";
import storyService from "../story/story.service.js";
import commentaryService from "../commentary/commentary.service.js";
import type { SearchOptions } from "./search-options.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

// Grouped by category, not merged into one ranked list — a message's
// ts_rank and a character's name-substring match aren't comparable scores,
// so there's no sound way to interleave them into a single ordering.
async function searchAll(query: string, limitParam?: number) {
    const limit = Math.min(Math.max(limitParam ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const [characters, items, messagesResult, storyLinesResult, commentariesResult] = await Promise.all([
        characterService.getAllCharacters({ search: query, limit, lite: true }),
        itemService.getAllItems(query, { limit, lite: true }),
        messageService.searchMessages(query, 1, limit),
        storyService.searchStoryLines(query, 1, limit),
        commentaryService.searchCommentaries(query, 1, limit),
    ]);

    // Notes come last (the user's call, 2026-11-09): they only take the slots
    // (limit per category, four categories) that every other match in the
    // archive, shown or not, leaves free
    const otherMatches = characters.length + items.length + messagesResult.total + storyLinesResult.total;
    const freeSlots = Math.max(0, limit * 4 - otherMatches);
    const commentaries = commentariesResult.data.slice(0, Math.min(limit, freeSlots));

    return { characters, items, messages: messagesResult.data, storyLines: storyLinesResult.data, commentaries };
}

const CATEGORY_PAGE_DEFAULT = 20;
const CATEGORY_PAGE_MAX = 50; // separate, more generous clamp than grouped mode's MAX_LIMIT — different mode, no shared knob

// Paginated single-category mode, backing the dedicated search-results page
// (comprehensive, not capped at 5) — messages/storyLines are the only
// categories that need this; characters/items are small enough to
// fetch unbounded via their own existing ?search= endpoints instead.
export type SearchCategory = "messages" | "storyLines" | "commentaries";
export const SEARCH_CATEGORIES: readonly SearchCategory[] = ["messages", "storyLines", "commentaries"];

async function searchCategory(
    category: SearchCategory,
    query: string,
    page?: number,
    limit?: number,
    options: SearchOptions = {}
) {
    const effectiveLimit = Math.min(Math.max(limit ?? CATEGORY_PAGE_DEFAULT, 1), CATEGORY_PAGE_MAX);
    const effectivePage = Math.max(page ?? 1, 1);
    if (category === "messages") {
        return messageService.searchMessages(query, effectivePage, effectiveLimit, options);
    }
    if (category === "commentaries") {
        return commentaryService.searchCommentaries(query, effectivePage, effectiveLimit, options);
    }
    return storyService.searchStoryLines(query, effectivePage, effectiveLimit, options);
}

export default { searchAll, searchCategory };
