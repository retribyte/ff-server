// The request body of an episode import, checked without touching the
// database (so the checks can be unit-tested anywhere).

// One episode as md-to-api.py writes it (archive-to-markdown/api/<season>/*.json):
// speakers by name, resolved here the same way api-import.py does.
export type ImportMessage = {
    player: string;
    character?: string | null;
    persona?: string | null;
    timestamp?: string | null;
    type: string;
    text: string;
};
export type ImportPayload = {
    seasonTitle: string;
    episode: {
        title: string;
        episode_no: number;
        summary?: string | null;
        playedDate?: string | null;
        reconstructed?: boolean;
        slug?: string;
    };
    messages: ImportMessage[];
};

const isStr = (v: unknown): v is string => typeof v === "string";

/** Checks the request body's shape: { episodes: ImportPayload[] }. Throws a 400-worthy Error. */
export function parsePayloads(body: unknown): ImportPayload[] {
    const episodes = (body as { episodes?: unknown })?.episodes;
    if (!Array.isArray(episodes) || episodes.length === 0) throw new Error("episodes must be a non-empty array");
    episodes.forEach((p: any, i) => {
        const where = `Episode ${i + 1}`;
        if (!p || !isStr(p.seasonTitle) || !p.seasonTitle) throw new Error(`${where}: seasonTitle is required`);
        if (!p.episode || !isStr(p.episode.title) || !p.episode.title) throw new Error(`${where}: episode.title is required`);
        if (!Number.isInteger(p.episode.episode_no)) throw new Error(`${where}: episode.episode_no must be an integer`);
        if (!Array.isArray(p.messages) || p.messages.length === 0) throw new Error(`${where}: messages must be a non-empty array`);
        p.messages.forEach((m: any, j: number) => {
            if (!m || !isStr(m.player) || !isStr(m.type) || !isStr(m.text)) {
                throw new Error(`${where}, message ${j + 1}: player, type and text are required`);
            }
        });
    });
    return episodes as ImportPayload[];
}
