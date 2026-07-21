import characterService from "../character/character.service.js";
import speciesService from "../species/species.service.js";
import itemService from "../item/item.service.js";
import messageService from "../message/message.service.js";
import storyService from "../story/story.service.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

// Grouped by category, not merged into one ranked list — a message's
// ts_rank and a character's name-substring match aren't comparable scores,
// so there's no sound way to interleave them into a single ordering.
async function searchAll(query: string, limitParam?: number) {
    const limit = Math.min(Math.max(limitParam ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const [characters, species, items, messagesResult, storyLinesResult] = await Promise.all([
        characterService.getAllCharacters({ search: query, limit, lite: true }),
        speciesService.getAllSpecies(query, { limit, lite: true }),
        itemService.getAllItems(query, { limit, lite: true }),
        messageService.searchMessages(query, 1, limit),
        storyService.searchStoryLines(query, 1, limit),
    ]);

    return { characters, species, items, messages: messagesResult.data, storyLines: storyLinesResult.data };
}

const CATEGORY_PAGE_DEFAULT = 20;
const CATEGORY_PAGE_MAX = 50; // separate, more generous clamp than grouped mode's MAX_LIMIT — different mode, no shared knob

// Paginated single-category mode, backing the dedicated search-results page
// (comprehensive, not capped at 5) — messages/storyLines are the only
// categories that need this; characters/species/items are small enough to
// fetch unbounded via their own existing ?search= endpoints instead.
async function searchCategory(
    category: "messages" | "storyLines",
    query: string,
    page?: number,
    limit?: number
) {
    const effectiveLimit = Math.min(Math.max(limit ?? CATEGORY_PAGE_DEFAULT, 1), CATEGORY_PAGE_MAX);
    const effectivePage = Math.max(page ?? 1, 1);
    if (category === "messages") {
        return messageService.searchMessages(query, effectivePage, effectiveLimit);
    }
    return storyService.searchStoryLines(query, effectivePage, effectiveLimit);
}

export default { searchAll, searchCategory };
