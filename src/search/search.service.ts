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

    const [characters, species, items, messages, storyLines] = await Promise.all([
        characterService.getAllCharacters({ search: query, limit, lite: true }),
        speciesService.getAllSpecies(query, { limit, lite: true }),
        itemService.getAllItems(query, { limit, lite: true }),
        messageService.searchMessages(query, limit),
        storyService.searchStoryLines(query, limit),
    ]);

    return { characters, species, items, messages, storyLines };
}

export default { searchAll };
