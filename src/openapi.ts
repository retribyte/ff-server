const spec = {
    openapi: "3.0.3",
    info: {
        title: "Final Frontier API",
        version: "1.0.0",
        description: "REST API for the Final Frontier lore archive and campaign reader.",
    },
    servers: [{ url: "/api" }],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
            },
        },
        schemas: {
            UserRole: { type: "string", enum: ["USER", "ADMIN"] },
            MessageType: {
                type: "string",
                enum: ["BOT_RESPONSE", "COMMAND", "QUOTE", "ACTION", "EMBED", "OTHER"],
            },
            ItemType: {
                type: "string",
                enum: ["WEAPON", "EQUIPMENT", "ARTIFACT", "OTHER"],
            },
            EightBallAnswerType: {
                type: "string",
                enum: ["YES", "NO", "MAYBE"],
            },
            User: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    username: { type: "string" },
                    email: { type: "string", nullable: true },
                    role: { $ref: "#/components/schemas/UserRole" },
                    icon: { type: "string", nullable: true, description: "Avatar image URL, resolved from iconBooruId" },
                    iconBooruId: { type: "integer", nullable: true, description: "booru.vortox.space post the avatar comes from" },
                    color: { type: "string", nullable: true, description: "Dark-mode hex color for characterless messages (e.g. the Vortox bot)" },
                    bio: { type: "string", nullable: true },
                    wikiUser: { type: "string", nullable: true },
                    passwordChangedAt: { type: "string", format: "date-time", nullable: true },
                    mustChangePassword: { type: "boolean", description: "Writes other than PUT /user/password are refused until the user changes their password" },
                    loginDisabled: { type: "boolean" },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                },
            },
            PublicUser: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    username: { type: "string" },
                    role: { $ref: "#/components/schemas/UserRole" },
                    icon: { type: "string", nullable: true },
                    iconBooruId: { type: "integer", nullable: true },
                    bio: { type: "string", nullable: true },
                    wikiUser: { type: "string", nullable: true },
                    createdAt: { type: "string", format: "date-time" },
                    characters: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "integer" },
                                name: { type: "string" },
                                slug: { type: "string" },
                                image: { type: "string", nullable: true },
                                color: { type: "string", nullable: true },
                            },
                        },
                    },
                    stories: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "integer" },
                                slug: { type: "string" },
                                title: { type: "string" },
                                publishedDate: { type: "string", format: "date-time", nullable: true },
                            },
                        },
                    },
                    _count: {
                        type: "object",
                        properties: { messages: { type: "integer" }, commentaries: { type: "integer" } },
                    },
                },
            },
            Character: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                    image: { type: "string", nullable: true },
                    color: { type: "string", nullable: true, description: "Dark-mode display color, #rrggbb" },
                    colorLight: {
                        type: "string",
                        nullable: true,
                        description: "Light-mode display color, #rrggbb; null = the site derives one from `color`",
                    },
                    blurb: { type: "string", nullable: true },
                    creatorId: { type: "integer" },
                    slug: { type: "string" },
                },
            },
            WikiSpecies: {
                type: "object",
                description: "A species as cached from the wiki's `species` Bucket. The wiki owns species lore; this API only serves the cache.",
                properties: {
                    slug: { type: "string" },
                    name: { type: "string", description: "The wiki page name" },
                    fetchedAt: { type: "string", format: "date-time", description: "When the row was last read from the wiki" },
                    data: {
                        type: "object",
                        additionalProperties: true,
                        description: "Every field the wiki's species schema has (diet, homeworld, class, ...); repeated fields are arrays",
                    },
                },
            },
            Season: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    episodes: { type: "array", items: { $ref: "#/components/schemas/Episode" } },
                    slug: { type: "string" },
                    kind: { type: "string", enum: ["MAINLINE", "SIDE", "PLANNED"] },
                },
            },
            Episode: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    seasonTitle: { type: "string" },
                    episode_no: { type: "integer" },
                    summary: { type: "string", nullable: true },
                    playedDate: { type: "string", format: "date-time", nullable: true },
                    slug: { type: "string" },
                    reconstructed: { type: "boolean", description: "Rewritten from memory, not recovered from logs" },
                },
            },
            Message: {
                type: "object",
                properties: {
                    episodeTitle: { type: "string" },
                    messageNo: { type: "integer" },
                    playerId: { type: "integer" },
                    characterId: { type: "integer", nullable: true },
                    personaId: {
                        type: "integer",
                        nullable: true,
                        description: "If set, the persona must belong to characterId; an NPC persona (characterId null) goes only on a line with no character. A QUOTE needs characterId or personaId (FR-MSG-4).",
                    },
                    persona: {
                        type: "object",
                        nullable: true,
                        description: "Included on reads: the era-correct presentation this message is attributed under (e.g. 'as Fungus', or just a different image/color). Nullable fields included so the site can build its lookup table without a second fetch.",
                        properties: {
                            id: { type: "integer" },
                            name: { type: "string", nullable: true },
                            image: { type: "string", nullable: true },
                            color: { type: "string", nullable: true },
                        },
                    },
                    timestamp: { type: "string", format: "date-time", nullable: true },
                    type: { $ref: "#/components/schemas/MessageType" },
                    text: { type: "string" },
                },
            },
            Persona: {
                type: "object",
                description: "A way a character is presented for some stretch of the archive: a different name, a different look, or both (FR-CHAR-3/9), e.g. Vec appears as 'Fungus' in FF4 episodes 2-10. Attached per message via Message.personaId — the only presentation mechanism. Named-persona slugs are permanent once created. A persona with characterId null is an NPC voice ('Enemy A', 'Receptionist'): always named, no slug or page, unique by case-insensitive name, admin-managed.",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string", nullable: true, description: "null = no name opinion, canonical character name shows" },
                    label: { type: "string", nullable: true, description: "Admin-facing handle (\"fungus era\", \"battle-scarred\"); never rendered in transcripts. Required when name is null." },
                    slug: { type: "string", nullable: true, description: "null for name-less personas (no URL identity)" },
                    image: { type: "string", nullable: true, description: "Era avatar; falls back to character.image" },
                    color: { type: "string", nullable: true, description: "Era theme color; falls back to character.color" },
                    characterId: { type: "integer", nullable: true, description: "null = NPC persona (no character behind it)" },
                },
            },
            SpeakerScope: {
                type: "object",
                description: "Narrows a speaker operation to part of a character's lines. Omit (or leave both empty) for all of them; only a full move deletes the source character.",
                properties: {
                    seasons: { type: "array", items: { type: "string" }, description: "Season slugs, e.g. [\"ff4\"]: messages in those seasons' episodes plus story lines in stories filed under them" },
                    messages: { type: "array", items: { type: "string" }, description: "'<episode_slug>#<messageNo>' refs; each must currently be voiced by the source character (else 409)" },
                },
            },
            StoryLineType: {
                type: "string",
                enum: ["NARRATION", "DIALOGUE", "ACTION", "TRANSCRIPT", "BREAK", "HEADING", "IMAGE"],
            },
            StoryFormat: {
                type: "string",
                enum: ["SCRIPT", "PROSE"],
                description: "Dialogue presentation: SCRIPT (whole-paragraph) or PROSE (novel-style, dialogue inline in narration)",
            },
            StorySegment: {
                type: "object",
                description: "A sub-paragraph span; texts concatenate verbatim to the line's text. A span may carry a voice (dialogue) and/or inline styling (italic/bold).",
                properties: {
                    text: { type: "string" },
                    characterId: { type: "integer", nullable: true },
                    speaker: { type: "string", nullable: true },
                    npc: {
                        type: "boolean",
                        description:
                            "An NPC voice: `speaker` is its name, or absent while unnamed (still dialogue). Named via PATCH /stories/{slug}/voices; can't carry a characterId",
                    },
                    italic: { type: "boolean" },
                    bold: { type: "boolean" },
                },
                required: ["text"],
            },
            Story: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    slug: { type: "string" },
                    title: { type: "string" },
                    blurb: { type: "string", nullable: true },
                    authors: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: { id: { type: "integer" }, username: { type: "string" }, icon: { type: "string", nullable: true } },
                        },
                    },
                    authorIds: { type: "array", items: { type: "integer" }, writeOnly: true, description: "Replaces the author list on update" },
                    publishedDate: { type: "string", format: "date-time", nullable: true },
                    themeColor: { type: "string", nullable: true },
                    themeColor2: { type: "string", nullable: true },
                    format: { $ref: "#/components/schemas/StoryFormat" },
                    canon: {
                        type: "boolean",
                        description: "false for a story outside the universe's continuity (a joke, a what-if). Defaults to true",
                    },
                    seasonTitle: { type: "string", nullable: true },
                    season: {
                        type: "object",
                        nullable: true,
                        properties: {
                            title: { type: "string" },
                            slug: { type: "string" },
                            kind: { type: "string", enum: ["MAINLINE", "SIDE", "PLANNED"] },
                        },
                    },
                    wordCount: {
                        type: "integer",
                        readOnly: true,
                        description: "Words in the story's prose (every line but breaks and pictures). GET /stories and GET /stories/{slug} only",
                    },
                    chapters: { type: "array", items: { $ref: "#/components/schemas/StoryChapter" } },
                },
            },
            StoryChapter: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    storyId: { type: "integer" },
                    chapter_no: { type: "integer" },
                    title: { type: "string", nullable: true },
                    wordCount: { type: "integer", readOnly: true, description: "As Story.wordCount, for this chapter" },
                },
            },
            StoryLine: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    chapterId: { type: "integer" },
                    line_no: { type: "integer" },
                    type: { $ref: "#/components/schemas/StoryLineType" },
                    text: { type: "string" },
                    characterId: { type: "integer", nullable: true },
                    speaker: { type: "string", nullable: true, description: "Display name when no Character row exists" },
                    npcVoice: {
                        type: "boolean",
                        description:
                            "DIALOGUE only: an NPC voice, named by `speaker` or unnamed (speaker null). Named via PATCH /stories/{slug}/voices",
                    },
                    segments: {
                        type: "array",
                        nullable: true,
                        description: "Sub-paragraph dialogue spans (NARRATION lines only); concatenation equals text",
                        items: { $ref: "#/components/schemas/StorySegment" },
                    },
                    booruId: {
                        type: "integer",
                        nullable: true,
                        description: "IMAGE only (required there): the booru.vortox.space post holding the picture; text is its alt text",
                    },
                    imageUrl: {
                        type: "string",
                        nullable: true,
                        readOnly: true,
                        description: "IMAGE only: the post's file URL, resolved from the booru at import (502 if it can't be reached)",
                    },
                },
            },
            Item: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                    itemType: { $ref: "#/components/schemas/ItemType" },
                    description: { type: "string" },
                    image: { type: "string", nullable: true },
                    creatorId: { type: "integer" },
                    slug: { type: "string" },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                },
            },
            EightBallAnswer: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    type: { $ref: "#/components/schemas/EightBallAnswerType" },
                    text: { type: "string" },
                },
            },
            SearchResults: {
                type: "object",
                description: "Grouped by category — scores aren't comparable across categories, so results aren't merged into one ranked list.",
                properties: {
                    characters: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "integer" },
                                name: { type: "string" },
                                slug: { type: "string" },
                                image: { type: "string", nullable: true },
                            },
                        },
                    },
                    items: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "integer" },
                                name: { type: "string" },
                                slug: { type: "string" },
                                image: { type: "string", nullable: true },
                            },
                        },
                    },
                    messages: {
                        type: "array",
                        description: "Full-text (stemmed keyword) matches on Message.text.",
                        items: {
                            type: "object",
                            properties: {
                                episodeTitle: { type: "string" },
                                messageNo: { type: "integer" },
                                text: { type: "string" },
                            },
                        },
                    },
                    storyLines: {
                        type: "array",
                        description: "Full-text (stemmed keyword) matches on StoryLine.text.",
                        items: {
                            type: "object",
                            properties: {
                                storySlug: { type: "string" },
                                chapterNo: { type: "integer" },
                                lineNo: { type: "integer" },
                                text: { type: "string" },
                            },
                        },
                    },
                },
            },
        },
    },
    paths: {
        "/version": {
            get: {
                tags: ["Meta"],
                summary: "The running API's version (from git tags; see docs/versioning.md)",
                security: [], // public — no token needed
                responses: {
                    "200": { description: "{ status, data: { version: \"1.1.14\", commit: \"3fa9c2e\" } }" },
                },
            },
        },
        "/register": {
            get: {
                tags: ["Auth"],
                summary: "Whether self-registration is open (REGISTRATION_OPEN=true)",
                security: [], // public — no token needed
                responses: {
                    "200": { description: "{ open: boolean }" },
                },
            },
            post: {
                tags: ["Auth"],
                summary: "Register a new user (only while REGISTRATION_OPEN=true)",
                security: [], // public — no token needed
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["username", "email", "password"],
                                properties: {
                                    username: { type: "string" },
                                    email: { type: "string" },
                                    password: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "User created" },
                    "400": { description: "Validation error or username taken" },
                    "403": { description: "Registration is closed" },
                },
            },
        },
        "/login": {
            post: {
                tags: ["Auth"],
                summary: "Log in and receive a JWT",
                security: [], // public — no token needed
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["username", "password"],
                                properties: {
                                    username: { type: "string" },
                                    password: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "JWT token returned" },
                    "400": { description: "Invalid credentials" },
                    "403": { description: "Account can't log in (system or disabled account)" },
                },
            },
        },
        "/user": {
            get: {
                tags: ["Auth"],
                summary: "Get the authenticated user's profile",
                description: "Read fresh from the database on every call. Still allowed while a password change is pending.",
                security: [{ bearerAuth: [] }],
                responses: {
                    "200": {
                        description: "User profile",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
                    },
                    "401": { description: "Unauthorized" },
                },
            },
            put: {
                tags: ["Auth"],
                summary: "Update the authenticated user's profile",
                description: "Usernames can't be changed (they key the archive import). Omitted fields are left as they are; null clears a field. Setting iconBooruId looks the post up on the booru and stores its image URL as icon.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    bio: { type: "string", nullable: true, maxLength: 2000 },
                                    wikiUser: { type: "string", nullable: true, maxLength: 100 },
                                    iconBooruId: { type: "integer", nullable: true },
                                    color: { type: "string", nullable: true, pattern: "^#[0-9a-fA-F]{6}$" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Updated profile" },
                    "400": { description: "Validation error, or no such booru post / not an image" },
                    "401": { description: "Unauthorized" },
                    "403": { description: "Password change required first" },
                    "502": { description: "The booru couldn't be reached" },
                },
            },
        },
        "/user/password": {
            put: {
                tags: ["Auth"],
                summary: "Change the authenticated user's password",
                description: "Invalidates every token issued before the change and clears mustChangePassword; returns a fresh token. Minimum length is PASSWORD_MIN_LENGTH (default 8); at most 72 bytes.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["currentPassword", "newPassword"],
                                properties: {
                                    currentPassword: { type: "string" },
                                    newPassword: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Password changed; data.token is the new access token" },
                    "400": { description: "Wrong current password, or new password breaks the rules" },
                    "401": { description: "Unauthorized" },
                },
            },
        },
        "/avatars/{file}": {
            get: {
                tags: ["Characters", "Personas"],
                summary: "An uploaded avatar PNG (public)",
                description: "Content-addressed, so responses are immutable. To upload, send a `data:image/png;base64,...` value as `image` when creating or updating a character or persona (with that route's permissions): at most 14x14 pixels and 16 KB. The record then stores this path.",
                security: [],
                parameters: [{ name: "file", in: "path", required: true, schema: { type: "string", pattern: "^[0-9a-f]{64}\\.png$" } }],
                responses: {
                    "200": { description: "The PNG", content: { "image/png": { schema: { type: "string", format: "binary" } } } },
                    "404": { description: "No such avatar" },
                },
            },
        },
        "/booru/image": {
            get: {
                tags: ["Auth"],
                summary: "Proxy an image from the booru (public)",
                description: "Fetches a booru.vortox.space /_images/ or /_thumbs/ URL server-side (past the booru's Cloudflare challenge) so browsers get it same-origin. Any other URL is refused. Cached; responses are immutable.",
                security: [],
                parameters: [{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } }],
                responses: {
                    "200": { description: "The image bytes", content: { "image/*": { schema: { type: "string", format: "binary" } } } },
                    "400": { description: "Missing url" },
                    "404": { description: "Not a booru image URL, or no such image" },
                    "502": { description: "The booru couldn't be reached" },
                },
            },
        },
        "/booru/{id}": {
            get: {
                tags: ["Auth"],
                summary: "Look up a booru post's image URLs (avatar preview)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "200": { description: "{ id, imageUrl, previewUrl }" },
                    "400": { description: "Invalid ID, or the post isn't an image" },
                    "401": { description: "Unauthorized" },
                    "404": { description: "No such post" },
                    "502": { description: "The booru couldn't be reached" },
                },
            },
        },
        "/users": {
            get: {
                tags: ["Auth"],
                summary: "List all users (full accounts for admins; {id, username, icon} for other members)",
                security: [{ bearerAuth: [] }],
                responses: {
                    "200": { description: "Array of users" },
                    "401": { description: "Unauthorized" },
                },
            },
        },
        "/users/{id}": {
            get: {
                tags: ["Auth"],
                summary: "Get a user's public profile by ID or username (public)",
                description: "`inactive` is true for a player who is still on the seeded or admin-reset password (they have never signed in as themselves).",
                security: [], // public — no token needed
                parameters: [{ name: "id", in: "path", required: true, description: "Numeric id, or username", schema: { type: "string" } }],
                responses: {
                    "200": {
                        description: "Public profile with the user's characters and stories",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/PublicUser" } } },
                    },
                    "404": { description: "User not found" },
                },
            },
        },
        "/users/{id}/role": {
            put: {
                tags: ["Auth"],
                summary: "Change a user's role (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["role"],
                                properties: { role: { $ref: "#/components/schemas/UserRole" } },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Updated user" },
                    "400": { description: "Invalid role" },
                    "403": { description: "Forbidden — not an admin" },
                },
            },
        },
        "/users/{id}/password-reset": {
            post: {
                tags: ["Auth"],
                summary: "Reset a player's password to the default (admin only)",
                description:
                    "Sets the account back to its default password (username lowercased, whitespace removed, plus \"123\"), " +
                    "requires a password change at next login and signs out every existing session. " +
                    "Refuses admin and system accounts.",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "200": { description: "Reset: { id, username, mustChangePassword }" },
                    "400": { description: "Admin or system account, or invalid id" },
                    "403": { description: "Forbidden — not an admin" },
                    "404": { description: "User not found" },
                },
            },
        },
        "/characters": {
            get: {
                tags: ["Characters"],
                summary: "List all characters",
                security: [], // public — no token needed
                parameters: [
                    { name: "search", in: "query", schema: { type: "string" }, description: "Search by name" },
                    { name: "ownerId", in: "query", schema: { type: "integer" } },
                    { name: "season", in: "query", schema: { type: "string" } },
                ],
                responses: {
                    "200": {
                        description:
                            "Array of characters, each with `seasons` (titles of the seasons it has messages in), " +
                            "`quoteCount` (what GET /characters/{id}/quotes lists: QUOTE messages plus story lines it speaks), " +
                            "`quoteWordCount` (words across those quotes; a segmented story paragraph counts only the character's own spans) and " +
                            "`appearances`: its first appearance in each campaign, `{season, episodeNo, messageNo}`, " +
                            "where episodeNo/messageNo are null for a story-only appearance and season is null for a story outside any campaign",
                    },
                },
            },
            post: {
                tags: ["Characters"],
                summary: "Create a character",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["name"],
                                properties: {
                                    name: { type: "string" },
                                    image: { type: "string" },
                                    color: { type: "string", description: "Dark-mode display color, #rrggbb" },
                                    colorLight: { type: "string", nullable: true, description: "Light-mode color, #rrggbb; null or omitted = derived from color" },
                                    blurb: { type: "string" },
                                    slug: {
                                        type: "string",
                                        pattern: "^[a-z0-9]+(_[a-z0-9]+)*$",
                                        description: "Defaults to a slugified name",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Character created" },
                    "400": { description: "Validation error" },
                    "401": { description: "Unauthorized" },
                },
            },
        },
        "/characters/{id}": {
            get: {
                tags: ["Characters"],
                summary: "Get a character by id, or by slug when the param isn't a bare integer",
                security: [], // public — no token needed
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "Numeric id or slug" }],
                responses: { "200": { description: "Character" }, "404": { description: "Not found" } },
            },
            put: {
                tags: ["Characters"],
                summary: "Update a character (owner or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Character" } } },
                },
                responses: {
                    "200": { description: "Updated character" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Not found" },
                },
            },
            delete: {
                tags: ["Characters"],
                summary: "Delete a character (owner or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "204": { description: "Deleted" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Not found" },
                    "409": { description: "The character speaks in the archive (a message, story line or in-paragraph story segment), so it can't be deleted" },
                },
            },
        },
        "/characters/{id}/quotes": {
            get: {
                tags: ["Characters", "Messages", "Stories"],
                summary: "Get quotes attributed to a character: transcript QUOTE messages and story-embedded dialogue",
                security: [], // public — no token needed
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "200": {
                        description: "{ messages: Message[], storyQuotes: StoryLine[] } — two arrays, no shared sort key between sources. Each story quote also carries storySlug, storyTitle, storySeason (its season title, or null) and chapterNo",
                    },
                },
            },
        },
        "/characters/{id}/appearances": {
            get: {
                tags: ["Characters", "Seasons"],
                summary: "A character's campaign appearances and most frequent co-stars",
                security: [], // public — no token needed
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "200": {
                        description:
                            "{ campaigns: [{season, slug, kind, episodes, seasonEpisodes, messages, first, last}], " +
                            "costars: [{id, name, slug, image, color, colorLight, episodes, stories}] }. " +
                            "campaigns counts every message type the character speaks in; first/last are " +
                            "{title, slug, episodeNo, messageNo, reconstructed}, archived episodes before reconstructed ones. " +
                            "costars are the (up to 6) characters sharing the most episodes plus stories with it, most first",
                    },
                    "400": { description: "id isn't an integer" },
                },
            },
        },
        "/seasons/{season}/cast": {
            get: {
                tags: ["Seasons", "Characters"],
                summary: "A campaign's player characters, and the ones that led each episode",
                description:
                    "Found from the transcripts: in each episode, every player's most active character (QUOTE + ACTION " +
                    "messages); plus characters admins added (PUT /characters/{id}/main-in). In a campaign with a GM, the NPC " +
                    "the GM voiced most in an episode counts too.",
                security: [], // public — no token needed
                parameters: [{ name: "season", in: "path", required: true, schema: { type: "string" }, description: "Season title or slug" }],
                responses: {
                    "200": {
                        description:
                            "{ season, characters: [{id, name, slug, image, color, messageCount, topEpisodes, manual}] (most messages first), " +
                            "byEpisode: { [episode title]: character ids, most messages first } }",
                    },
                    "404": { description: "Unknown season" },
                },
            },
        },
        "/characters/{id}/main-in": {
            put: {
                tags: ["Characters", "Seasons"],
                summary: "Add a character to campaigns' casts by hand (admin)",
                description:
                    "Replaces the list; [] clears it. These are added to the campaign's cast (GET /seasons/{season}/cast) " +
                    "on top of the characters found from its transcripts; for a story-only campaign they're the whole cast. " +
                    "Character reads carry `mainIn`.",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["seasons"],
                                properties: { seasons: { type: "array", items: { type: "string" }, description: "Season titles or slugs" } },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "The character, with mainIn: [{title, slug}]" },
                    "400": { description: "seasons isn't an array of strings, or names an unknown season" },
                    "403": { description: "Not an admin" },
                    "404": { description: "Not found" },
                },
            },
        },
        "/characters/{id}/personas": {
            get: {
                tags: ["Characters", "Personas"],
                summary: "List a character's personas",
                security: [], // public — no token needed
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: { "200": { description: "Array of personas" } },
            },
            post: {
                tags: ["Characters", "Personas"],
                summary: "Add a persona to a character (owner or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                description: "At least one of name/image/color is required; label is required when name is omitted",
                                properties: {
                                    name: { type: "string", description: "Omit for a look-only persona (image/color change with no name change)" },
                                    label: { type: "string", description: "Admin-facing handle; required when name is omitted" },
                                    slug: {
                                        type: "string",
                                        pattern: "^[a-z0-9]+(_[a-z0-9]+)*$",
                                        description: "Defaults to `<character_slug>_<name_slug>`; permanent once set. Ignored (no slug is created) when name is omitted.",
                                    },
                                    image: { type: "string" },
                                    color: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Persona created" },
                    "400": { description: "Validation error (no name/image/color set, missing label for a name-less persona, duplicate slug/name, character not found)" },
                    "401": { description: "Unauthorized" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Character not found" },
                },
            },
        },
        "/personas": {
            get: {
                tags: ["Personas"],
                summary: "Full persona index, optionally filtered by name — no pagination. Intended for bulk speaker-name matching (e.g. the transcript importer) without N+1-ing over /characters/:id/personas. Includes NPC personas (characterId null).",
                security: [], // public — no token needed
                parameters: [
                    { name: "search", in: "query", schema: { type: "string" }, description: "Search by persona name" },
                    { name: "npc", in: "query", schema: { type: "string", enum: ["true", "false"] }, description: "true: only NPC personas, sorted by name, each with messageCount; false: only character personas" },
                ],
                responses: { "200": { description: "Array of every persona" } },
            },
            post: {
                tags: ["Personas"],
                summary: "Find or create an NPC persona by case-insensitive name (admin only)",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["name"],
                                properties: { name: { type: "string" }, image: { type: "string" }, color: { type: "string" } },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "An NPC persona with that name already existed; returned unchanged" },
                    "201": { description: "NPC persona created" },
                    "400": { description: "Validation error" },
                    "401": { description: "Unauthorized" },
                    "403": { description: "Forbidden" },
                },
            },
        },
        "/personas/{id}": {
            put: {
                tags: ["Personas"],
                summary: "Update a persona (owner of the parent character, or admin; NPC personas are admin-only, keep a name and take no slug)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    name: { type: "string", nullable: true },
                                    label: { type: "string", nullable: true },
                                    slug: { type: "string", pattern: "^[a-z0-9]+(_[a-z0-9]+)*$" },
                                    image: { type: "string", nullable: true },
                                    color: { type: "string", nullable: true },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Updated persona" },
                    "400": { description: "Validation error (no name/image/color set, missing label for a name-less persona, duplicate slug/name)" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Not found" },
                },
            },
            delete: {
                tags: ["Personas"],
                summary: "Delete a persona (owner of the parent character, or admin; NPC personas are admin-only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "204": { description: "Deleted" },
                    "400": { description: "Cannot delete: messages still reference this persona" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Not found" },
                },
            },
        },
        "/admin/speakers/demote": {
            post: {
                tags: ["Speakers"],
                summary: "Turn a character into an NPC voice (admin only)",
                description: "Moves the character's lines to the NPC persona of the same name (found or created) or to intoPersonaId: messages get characterId null + that persona; story lines and in-paragraph segments lose the character and keep its name as speaker text. A full (unscoped) move then deletes the character. One transaction.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["characterId"],
                                properties: {
                                    characterId: { type: "integer" },
                                    intoPersonaId: { type: "integer", description: "An existing NPC persona to fold into" },
                                    scope: { $ref: "#/components/schemas/SpeakerScope" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "{persona, personaCreated, messages, storyLines, storySegmentLines, deletedCharacter}" },
                    "400": { description: "Validation error (bad scope, unknown season, persona isn't an NPC)" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Character or persona not found" },
                    "409": { description: "A msg: ref isn't voiced by this character, or the character is still referenced after the move" },
                },
            },
        },
        "/admin/speakers/promote": {
            post: {
                tags: ["Speakers"],
                summary: "Turn an NPC voice into a character (admin only)",
                description: "Creates a character from the NPC persona (owner defaults to the player who voiced most of its lines), moves its messages to the character with no persona, and deletes the NPC persona. One transaction.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["personaId"],
                                properties: {
                                    personaId: { type: "integer" },
                                    ownerId: { type: "integer", description: "Required when the NPC has no lines" },
                                    name: { type: "string", description: "Defaults to the persona name" },
                                    slug: { type: "string", pattern: "^[a-z0-9]+(_[a-z0-9]+)*$", description: "Defaults to slugify(name)" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "{character, messages}" },
                    "400": { description: "Validation error" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Persona or owner not found" },
                    "409": { description: "Slug already taken" },
                },
            },
        },
        "/admin/speakers/merge": {
            post: {
                tags: ["Speakers"],
                summary: "Move one character's lines onto another (admin only)",
                description: "Plain merge: the lines show the target's canonical name (personas stamped on them are cleared). asPersona: they're stamped with a persona of the target named after the source (found or created), so they keep reading as before. A full (unscoped) move then deletes the source. One transaction.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["sourceId", "targetId"],
                                properties: {
                                    sourceId: { type: "integer" },
                                    targetId: { type: "integer" },
                                    asPersona: { type: "boolean" },
                                    scope: { $ref: "#/components/schemas/SpeakerScope" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "{target, persona, personaCreated, messages, storyLines, storySegmentLines, deletedCharacter}" },
                    "400": { description: "Validation error (merge into itself, bad scope)" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Character not found" },
                    "409": { description: "A msg: ref isn't voiced by the source, or the source is still referenced after the move" },
                },
            },
        },
        "/admin/speakers/rename": {
            post: {
                tags: ["Speakers"],
                summary: "Rename a character and/or change its slug (admin only; before go-live, since slugs are permanent once public)",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["characterId"],
                                properties: {
                                    characterId: { type: "integer" },
                                    name: { type: "string" },
                                    slug: { type: "string", pattern: "^[a-z0-9]+(_[a-z0-9]+)*$" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Updated character" },
                    "400": { description: "Validation error" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Character not found" },
                    "409": { description: "Slug or name already taken" },
                },
            },
        },
        "/species": {
            get: {
                tags: ["Species"],
                summary: "List the species cached from the wiki",
                description: "Read-only. Served from the wiki cache, which `npm run refresh:wiki-cache` fills; species absent from the wiki are left out.",
                security: [], // public — no token needed
                parameters: [{ name: "search", in: "query", schema: { type: "string" }, description: "Matches the slug or the wiki page name" }],
                responses: {
                    "200": {
                        description: "Array of cached species",
                        content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/WikiSpecies" } } } },
                    },
                },
            },
        },
        "/species/{slug}": {
            get: {
                tags: ["Species"],
                summary: "Get one cached species by slug",
                description: "Read-only, from the wiki cache. A slug that isn't cached is a 404; this never fetches from the wiki live.",
                security: [], // public — no token needed
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                responses: {
                    "200": { description: "Cached species", content: { "application/json": { schema: { $ref: "#/components/schemas/WikiSpecies" } } } },
                    "404": { description: "Not cached, or cached as absent from the wiki" },
                },
            },
        },
        "/seasons": {
            get: {
                tags: ["Seasons"],
                summary: "List all seasons",
                security: [], // public — no token needed
                parameters: [{ name: "search", in: "query", schema: { type: "string" } }],
                responses: { "200": { description: "Array of seasons with episodes" } },
            },
            post: {
                tags: ["Seasons"],
                summary: "Create a season (admin only)",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["title"],
                                properties: {
                                    title: { type: "string" },
                                    slug: {
                                        type: "string",
                                        pattern: "^[a-z0-9]+(_[a-z0-9]+)*$",
                                        description: "Defaults to a slugified title",
                                    },
                                    kind: {
                                        type: "string",
                                        enum: ["MAINLINE", "SIDE", "PLANNED"],
                                        description: "Campaign role; defaults to SIDE. Only MAINLINE seasons are on the front-page roster.",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Season created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/seasons/{title}": {
            get: {
                tags: ["Seasons"],
                summary: "Get a season by title with its episodes",
                security: [], // public — no token needed
                parameters: [{ name: "title", in: "path", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "Season" }, "404": { description: "Not found" } },
            },
            put: {
                tags: ["Seasons"],
                summary: "Rename a season and/or change its kind (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "title", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["title"],
                                properties: {
                                    title: { type: "string" },
                                    slug: {
                                        type: "string",
                                        pattern: "^[a-z0-9]+(_[a-z0-9]+)*$",
                                        description: "Explicit only — not re-derived from the new title",
                                    },
                                    kind: {
                                        type: "string",
                                        enum: ["MAINLINE", "SIDE", "PLANNED"],
                                        description: "Omit to leave unchanged",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: { "200": { description: "Updated season" }, "403": { description: "Forbidden" } },
            },
            delete: {
                tags: ["Seasons"],
                summary: "Delete a season (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "title", in: "path", required: true, schema: { type: "string" } }],
                responses: { "204": { description: "Deleted" }, "403": { description: "Forbidden" } },
            },
        },
        "/episodes": {
            get: {
                tags: ["Episodes"],
                summary: "List all episodes",
                security: [], // public — no token needed
                parameters: [{ name: "search", in: "query", schema: { type: "string" } }],
                responses: { "200": { description: "Array of episodes" } },
            },
            post: {
                tags: ["Episodes"],
                summary: "Create an episode within a season (admin only)",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["title", "seasonTitle", "episode_no"],
                                properties: {
                                    title: { type: "string" },
                                    seasonTitle: { type: "string" },
                                    episode_no: { type: "integer" },
                                    summary: { type: "string" },
                                    playedDate: { type: "string", format: "date-time" },
                                    slug: {
                                        type: "string",
                                        pattern: "^[a-z0-9]+(_[a-z0-9]+)*$",
                                        description: "Defaults to `<slugified_title>`",
                                    },
                                    reconstructed: { type: "boolean", default: false },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Episode created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/episodes/import": {
            post: {
                tags: ["Episodes"],
                summary: "Retired — always 410 Gone",
                deprecated: true,
                description:
                    "Episode import is closed to the web now that the archive is seeded; re-imports go through " +
                    "archive-to-markdown/api-import.py (POST /episodes + /episodes/{episodeTitle}/messages). " +
                    "The body below is the shape it accepted while enabled.",
                security: [],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["seasonTitle", "episode", "messages"],
                                properties: {
                                    seasonTitle: { type: "string" },
                                    episode: {
                                        type: "object",
                                        required: ["title", "episode_no"],
                                        properties: {
                                            title: { type: "string" },
                                            episode_no: { type: "integer" },
                                            summary: { type: "string" },
                                            playedDate: { type: "string", format: "date-time" },
                                            slug: { type: "string", pattern: "^[a-z0-9]+(_[a-z0-9]+)*$" },
                                        },
                                    },
                                    messages: { type: "array", items: { $ref: "#/components/schemas/Message" } },
                                },
                            },
                        },
                    },
                },
                responses: { "410": { description: "Episode import is retired" } },
            },
        },
        "/episodes/{title}": {
            get: {
                tags: ["Episodes"],
                summary: "Get an episode by title",
                security: [], // public — no token needed
                parameters: [{ name: "title", in: "path", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "Episode" }, "404": { description: "Not found" } },
            },
            put: {
                tags: ["Episodes"],
                summary: "Update episode metadata (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "title", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Episode" } } },
                },
                responses: { "200": { description: "Updated episode" }, "403": { description: "Forbidden" } },
            },
            delete: {
                tags: ["Episodes"],
                summary: "Delete an episode and its messages (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "title", in: "path", required: true, schema: { type: "string" } }],
                responses: { "204": { description: "Deleted" }, "403": { description: "Forbidden" } },
            },
        },
        "/episodes/{episodeTitle}/messages": {
            get: {
                tags: ["Messages"],
                summary: "Get paginated messages in an episode",
                security: [], // public — no token needed
                parameters: [
                    { name: "episodeTitle", in: "path", required: true, schema: { type: "string" } },
                    { name: "page", in: "query", schema: { type: "integer", default: 1 } },
                    { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
                    { name: "search", in: "query", schema: { type: "string" }, description: "Full-text search within transcript" },
                ],
                responses: { "200": { description: "Paginated messages" } },
            },
        },
        "/episodes/{episodeTitle}/messages/{messageNo}": {
            get: {
                tags: ["Messages"],
                summary: "Get a single message by episode and sequence number",
                security: [], // public — no token needed
                parameters: [
                    { name: "episodeTitle", in: "path", required: true, schema: { type: "string" } },
                    { name: "messageNo", in: "path", required: true, schema: { type: "integer" } },
                ],
                responses: { "200": { description: "Message" }, "404": { description: "Not found" } },
            },
            put: {
                tags: ["Messages"],
                summary: "Update a message (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [
                    { name: "episodeTitle", in: "path", required: true, schema: { type: "string" } },
                    { name: "messageNo", in: "path", required: true, schema: { type: "integer" } },
                ],
                requestBody: {
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Message" } } },
                },
                responses: { "200": { description: "Updated message" }, "401": { description: "Unauthorized" } },
            },
        },
        "/episodes/{episodeTitle}/personas/apply": {
            post: {
                tags: ["Messages", "Personas"],
                summary: "Bulk-stamp personaId on every message of a character within this episode (owner of the character, or admin)",
                description: "Write-time 'set it once' bulk assignment (PLAN-alias.md §4): sets personaId on every message matching {characterId} in this episode. personaId: null clears those messages back to canonical (character-only) attribution. Exceptions afterward go through the per-message PUT.",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "episodeTitle", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["characterId", "personaId"],
                                properties: {
                                    characterId: { type: "integer" },
                                    personaId: { type: "integer", nullable: true, description: "null clears every matching message back to canonical attribution" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "{ count: number } — how many messages were updated" },
                    "400": { description: "Validation error (missing/invalid characterId or personaId, persona belongs to a different character)" },
                    "401": { description: "Unauthorized" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Episode or character not found" },
                },
            },
        },
        "/seasons/{seasonTitle}/personas/apply": {
            post: {
                tags: ["Messages", "Personas"],
                summary: "Bulk-stamp personaId on every message of a character across every episode of this season (owner of the character, or admin)",
                description: "Same semantics as the episode variant, applied across every episode of the season.",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "seasonTitle", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["characterId", "personaId"],
                                properties: {
                                    characterId: { type: "integer" },
                                    personaId: { type: "integer", nullable: true, description: "null clears every matching message back to canonical attribution" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "{ count: number } — how many messages were updated" },
                    "400": { description: "Validation error (missing/invalid characterId or personaId, persona belongs to a different character)" },
                    "401": { description: "Unauthorized" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Season or character not found" },
                },
            },
        },
        "/quotes/random": {
            get: {
                tags: ["Messages"],
                summary: "Get a random QUOTE message from a character (NPC lines are left out)",
                security: [], // public — no token needed
                responses: { "200": { description: "A random quote" }, "404": { description: "No quotes found" } },
            },
        },
        "/stories": {
            get: {
                tags: ["Stories"],
                summary: "List all stories with chapter summaries",
                security: [], // public — no token needed
                parameters: [
                    { name: "search", in: "query", schema: { type: "string" }, description: "Search title and blurb" },
                    { name: "season", in: "query", schema: { type: "string" }, description: "Only stories in this season (title or slug)" },
                ],
                responses: { "200": { description: "Array of stories" } },
            },
            post: {
                tags: ["Stories"],
                summary: "Create a story (admin only)",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["slug", "title"],
                                properties: {
                                    slug: { type: "string", pattern: "^[a-z0-9]+(_[a-z0-9]+)*$" },
                                    title: { type: "string" },
                                    blurb: { type: "string" },
                                    authorIds: { type: "array", items: { type: "integer" }, description: "User ids credited as authors" },
                                    publishedDate: { type: "string", format: "date-time" },
                                    themeColor: { type: "string" },
                                    themeColor2: { type: "string" },
                                    season: { type: "string", nullable: true, description: "Season title or slug; null clears" },
                                    format: { $ref: "#/components/schemas/StoryFormat" },
                                    canon: { type: "boolean", default: true, description: "false = outside continuity" },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Story created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/stories/convert": {
            post: {
                tags: ["Stories"],
                summary: "Convert a Google Docs .docx export into a story import payload (any member; writes nothing)",
                description:
                    "Without `meta`: an analysis for the color → speaker form (every ink color with samples, Title/Subtitle " +
                    "defaults, how many embedded pictures won't come across). With `meta`: the payload `{story, authors, chapters}` " +
                    "with speakers as names, ready for POST /stories/import after speaker → character matching, plus the " +
                    "markdown manuscript and converter warnings. Every color in the doc must be mapped (null = narration). Body limit 10mb.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["docx"],
                                properties: {
                                    docx: { type: "string", format: "byte", description: "The .docx file, base64" },
                                    fileName: { type: "string", description: "Fallback for the default slug" },
                                    meta: {
                                        type: "object",
                                        required: ["title", "colors"],
                                        properties: {
                                            title: { type: "string" },
                                            slug: { type: "string", pattern: "^[a-z0-9]+(_[a-z0-9]+)*$" },
                                            format: { type: "string", enum: ["prose", "script"], default: "prose" },
                                            blurb: { type: "string" },
                                            authors: { type: "string", description: "Comma-separated usernames" },
                                            published: { type: "string", format: "date" },
                                            season: { type: "string" },
                                            themeColor: { type: "string" },
                                            themeColor2: { type: "string" },
                                            canon: { type: "boolean", description: "false writes `canon: no` into the manuscript" },
                                            colors: {
                                                type: "object",
                                                additionalProperties: { type: "string", nullable: true },
                                                description: "`#rrggbb` → speaker name, or null for narration ink",
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Analysis, or { payload, markdown, warnings }" },
                    "400": { description: "Not a usable .docx, or invalid meta" },
                    "401": { description: "Unauthorized" },
                },
            },
        },
        "/admin/jobs": {
            get: {
                tags: ["Admin"],
                summary: "The maintenance jobs, each with its latest run (admin)",
                security: [{ bearerAuth: [] }],
                responses: {
                    "200": { description: "[{name, title, description, lastRun: JobRun (no log) | null}]" },
                    "403": { description: "Not an admin" },
                },
            },
        },
        "/admin/jobs/{name}/run": {
            post: {
                tags: ["Admin"],
                summary: "Run a maintenance job (admin)",
                description: "Runs in one transaction; a dry run rolls back. A failed run is still a 200, with status FAILED.",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    content: { "application/json": { schema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } } },
                },
                responses: {
                    "200": { description: "The JobRun, with its log" },
                    "403": { description: "Not an admin" },
                    "404": { description: "No such job" },
                    "409": { description: "That job is already running" },
                },
            },
        },
        "/views": {
            post: {
                tags: ["Views"],
                summary: "Count one view of an episode or story (public)",
                description:
                    "Aggregate daily counters only; nothing per user is stored. Counted as a member view when the bearer token is valid, " +
                    "otherwise as anonymous (a bad token is not an error).",
                security: [],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["kind", "slug"],
                                properties: { kind: { type: "string", enum: ["episode", "story"] }, slug: { type: "string" } },
                            },
                        },
                    },
                },
                responses: { "200": { description: "Counted" }, "400": { description: "Bad kind or slug" }, "404": { description: "No such episode or story" } },
            },
        },
        "/admin/views": {
            get: {
                tags: ["Admin", "Views"],
                summary: "Views per episode and story, most viewed first (admin)",
                security: [{ bearerAuth: [] }],
                parameters: [
                    { name: "days", in: "query", description: "Window, in UTC days including today", schema: { type: "integer", default: 30, maximum: 365 } },
                    { name: "kind", in: "query", schema: { type: "string", enum: ["episode", "story"] } },
                    { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
                ],
                responses: { "200": { description: "{kind, slug, title, member, anonymous}[]" }, "403": { description: "Not an admin" } },
            },
        },
        "/admin/logs": {
            get: {
                tags: ["Admin"],
                summary: "Recent log entries, newest first (admin)",
                description:
                    "From the server's in-memory buffer (last 2000 entries; a restart refills it from the last day's log file). " +
                    "Each entry is {time, level, event, reqId?, userId?, username?, ...fields}.",
                security: [{ bearerAuth: [] }],
                parameters: [
                    { name: "level", in: "query", description: "Minimum level", schema: { type: "string", enum: ["debug", "info", "warn", "error"] } },
                    { name: "event", in: "query", description: "Event name or prefix, e.g. auth", schema: { type: "string" } },
                    { name: "user", in: "query", description: "Username or user id", schema: { type: "string" } },
                    { name: "q", in: "query", description: "Case-insensitive text search over the whole entry", schema: { type: "string" } },
                    { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
                    { name: "limit", in: "query", schema: { type: "integer", default: 200, maximum: 2000 } },
                ],
                responses: { "200": { description: "LogEntry[]" }, "400": { description: "Bad since" }, "403": { description: "Not an admin" } },
            },
        },
        "/admin/job-runs": {
            get: {
                tags: ["Admin"],
                summary: "Recent job runs, newest first, without logs (admin)",
                security: [{ bearerAuth: [] }],
                parameters: [
                    { name: "job", in: "query", schema: { type: "string" } },
                    { name: "limit", in: "query", schema: { type: "integer", default: 25, maximum: 100 } },
                ],
                responses: { "200": { description: "JobRun[]" }, "403": { description: "Not an admin" } },
            },
        },
        "/admin/job-runs/{id}": {
            get: {
                tags: ["Admin"],
                summary: "One job run with its log (admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: { "200": { description: "JobRun" }, "403": { description: "Not an admin" }, "404": { description: "Not found" } },
            },
        },
        "/admin/episode-import/preview": {
            post: {
                tags: ["Admin", "Episodes"],
                summary: "What an episode import would do; writes nothing (admin)",
                description:
                    "Body: {episodes: [md-to-api.py episode JSON]}. Speakers resolve as api-import.py does. Returns, per episode, " +
                    "its conflicts (already in the archive, slug or number taken, duplicated in the batch), plus the players with " +
                    "no account, the NPC voices and personas it would create, and case-insensitive character matches.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { type: "object", required: ["episodes"], properties: { episodes: { type: "array", items: { type: "object" } } } },
                        },
                    },
                },
                responses: {
                    "200": { description: "{episodes: [{title, seasonTitle, episodeNo, reconstructed, messages, newSeason, conflicts}], missingPlayers, newNpcVoices, newPersonas, caseMatches, ok}" },
                    "400": { description: "Malformed episodes" },
                    "403": { description: "Not an admin" },
                },
            },
        },
        "/admin/episode-import": {
            post: {
                tags: ["Admin", "Episodes"],
                summary: "Import new episodes, all or nothing (admin)",
                description:
                    "Same body as the preview, plus dryRun. Creates the new NPC voices and personas, then every episode and its " +
                    "messages in one transaction. Refuses the whole batch if a player has no account or any episode conflicts " +
                    "(recorded as a FAILED run). Never replaces an episode; re-imports go through api-import.py.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["episodes"],
                                properties: { episodes: { type: "array", items: { type: "object" } }, dryRun: { type: "boolean", default: false } },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "The JobRun, with its log" },
                    "400": { description: "Malformed episodes" },
                    "403": { description: "Not an admin" },
                    "409": { description: "An episode import is already running" },
                },
            },
        },
        "/stories/import": {
            post: {
                tags: ["Stories"],
                summary: "Atomically import a whole story with its chapters and lines (any member, who is always credited as an author)",
                description:
                    "One transaction: the story, every chapter, and every line (numbered 1..n per chapter). Either all of it " +
                    "lands or none does. Duplicate detection: 409 when the slug or title (case-insensitive) is taken, or when " +
                    "the lines' text is identical to an existing story's (Story.contentHash). Body limit 10mb.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["story", "chapters"],
                                properties: {
                                    importMeta: {
                                        type: "object",
                                        nullable: true,
                                        description:
                                            "How a Google Doc import read the doc, remembered on the story (Story.importMeta) so a " +
                                            "revision only asks about new colors. Omit it for other imports.",
                                        properties: {
                                            format: { type: "string", enum: ["prose", "script"] },
                                            colors: {
                                                type: "object",
                                                additionalProperties: { type: "string", nullable: true },
                                                description: "`#rrggbb` → speaker name, \"?\" for unnamed NPCs, or null for narration",
                                            },
                                        },
                                    },
                                    story: {
                                        type: "object",
                                        required: ["slug", "title"],
                                        properties: {
                                            slug: { type: "string", pattern: "^[a-z0-9]+(_[a-z0-9]+)*$" },
                                            title: { type: "string" },
                                            blurb: { type: "string" },
                                            authorIds: { type: "array", items: { type: "integer" } },
                                            publishedDate: { type: "string", format: "date-time" },
                                            themeColor: { type: "string" },
                                            themeColor2: { type: "string" },
                                            season: { type: "string", nullable: true, description: "Season title or slug" },
                                            format: { $ref: "#/components/schemas/StoryFormat" },
                                            canon: { type: "boolean", default: true, description: "false = outside continuity" },
                                        },
                                    },
                                    chapters: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            required: ["chapter_no", "lines"],
                                            properties: {
                                                chapter_no: { type: "integer", minimum: 0, description: "0 for a preface before Chapter 1" },
                                                title: { type: "string", nullable: true },
                                                lines: { type: "array", items: { $ref: "#/components/schemas/StoryLine" } },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Story imported (same shape as GET /stories/{slug}, plus lineCount)" },
                    "400": { description: "Invalid payload — nothing was written" },
                    "401": { description: "Unauthorized" },
                    "409": { description: "Slug/title taken, or identical text already imported — nothing was written" },
                },
            },
        },
        "/stories/{slug}/import": {
            put: {
                tags: ["Stories"],
                summary: "Atomically replace a story's chapters and lines with a revised draft (story authors or admins)",
                description:
                    "One transaction: deletes every chapter and line, then writes the new ones (numbered 1..n per chapter). " +
                    "The story's id, slug, title, authors, season, blurb and theme are kept. Line numbers may shift. Body limit 10mb.",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["chapters"],
                                properties: {
                                    importMeta: {
                                        type: "object",
                                        nullable: true,
                                        description:
                                            "How a Google Doc import read the doc, remembered on the story (Story.importMeta) so a " +
                                            "revision only asks about new colors. Omit it to keep the stored one.",
                                        properties: {
                                            format: { type: "string", enum: ["prose", "script"] },
                                            colors: {
                                                type: "object",
                                                additionalProperties: { type: "string", nullable: true },
                                                description: "`#rrggbb` → speaker name, \"?\" for unnamed NPCs, or null for narration",
                                            },
                                        },
                                    },
                                    chapters: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            required: ["chapter_no", "lines"],
                                            properties: {
                                                chapter_no: { type: "integer", minimum: 0 },
                                                title: { type: "string", nullable: true },
                                                lines: { type: "array", items: { $ref: "#/components/schemas/StoryLine" } },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Story revised (same shape as GET /stories/{slug}, plus lineCount)" },
                    "400": { description: "Invalid draft — nothing was changed" },
                    "401": { description: "Unauthorized" },
                    "403": { description: "Not one of this story's authors, and not an admin" },
                    "404": { description: "No story with that slug" },
                    "409": { description: "The draft's text is identical to a different story — nothing was changed" },
                },
            },
        },
        "/stories/{slug}/voices": {
            patch: {
                tags: ["Stories"],
                summary: "Name NPC voice fragments while reading (story authors or admins)",
                description:
                    "Names (or, with a null/blank speaker, un-names) NPC voice fragments: a segment of a NARRATION line " +
                    "(`segment` = its index), or a whole `npcVoice` DIALOGUE line (`segment` omitted). Only NPC-flagged " +
                    "fragments can be named here, so the text and character attributions never change. One transaction: " +
                    "any invalid assignment rejects them all. A later revision (PUT /stories/{slug}/import) keeps these " +
                    "names for fragments whose text is unchanged.",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["assignments"],
                                properties: {
                                    assignments: {
                                        type: "array",
                                        minItems: 1,
                                        maxItems: 500,
                                        items: {
                                            type: "object",
                                            required: ["chapterNo", "lineNo", "speaker"],
                                            properties: {
                                                chapterNo: { type: "integer" },
                                                lineNo: { type: "integer" },
                                                segment: { type: "integer", nullable: true },
                                                speaker: { type: "string", nullable: true, maxLength: 80 },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "The updated lines: [{ chapterNo, lineNo, speaker, segments }]" },
                    "400": { description: "Invalid assignment (not an NPC voice, no such line) — nothing was changed" },
                    "401": { description: "Unauthorized" },
                    "403": { description: "Not one of this story's authors, and not an admin" },
                    "404": { description: "No story with that slug" },
                },
            },
        },
        "/stories/{slug}": {
            get: {
                tags: ["Stories"],
                summary: "Get a story by slug with chapter summaries",
                security: [], // public — no token needed
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "Story" }, "404": { description: "Not found" } },
            },
            put: {
                tags: ["Stories"],
                summary: "Update story metadata (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Story" } } },
                },
                responses: { "200": { description: "Updated story" }, "403": { description: "Forbidden" } },
            },
            delete: {
                tags: ["Stories"],
                summary: "Delete a story with its chapters and lines (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                responses: { "204": { description: "Deleted" }, "403": { description: "Forbidden" } },
            },
        },
        "/stories/{slug}/chapters": {
            post: {
                tags: ["Stories"],
                summary: "Add a chapter (auto-numbered when chapter_no omitted) (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    title: { type: "string" },
                                    chapter_no: { type: "integer" },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Chapter created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/stories/{slug}/chapters/{chapterNo}": {
            put: {
                tags: ["Stories"],
                summary: "Retitle a chapter (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [
                    { name: "slug", in: "path", required: true, schema: { type: "string" } },
                    { name: "chapterNo", in: "path", required: true, schema: { type: "integer" } },
                ],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: { type: "object", properties: { title: { type: "string", nullable: true } } },
                        },
                    },
                },
                responses: { "200": { description: "Updated chapter" }, "401": { description: "Unauthorized" } },
            },
            delete: {
                tags: ["Stories"],
                summary: "Delete a chapter and its lines (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [
                    { name: "slug", in: "path", required: true, schema: { type: "string" } },
                    { name: "chapterNo", in: "path", required: true, schema: { type: "integer" } },
                ],
                responses: { "204": { description: "Deleted" }, "403": { description: "Forbidden" } },
            },
        },
        "/stories/{slug}/chapters/{chapterNo}/lines": {
            get: {
                tags: ["Stories"],
                summary: "Get paginated lines in a chapter",
                security: [], // public — no token needed
                parameters: [
                    { name: "slug", in: "path", required: true, schema: { type: "string" } },
                    { name: "chapterNo", in: "path", required: true, schema: { type: "integer" } },
                    { name: "page", in: "query", schema: { type: "integer", default: 1 } },
                    { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
                    { name: "search", in: "query", schema: { type: "string" }, description: "Full-text search within the chapter" },
                ],
                responses: { "200": { description: "Paginated lines; response also carries a `characters` array hydrating any Character referenced only inside segment spans" }, "404": { description: "Not found" } },
            },
            post: {
                tags: ["Stories"],
                summary: "Bulk-append lines to a chapter (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [
                    { name: "slug", in: "path", required: true, schema: { type: "string" } },
                    { name: "chapterNo", in: "path", required: true, schema: { type: "integer" } },
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["lines"],
                                properties: {
                                    lines: { type: "array", items: { $ref: "#/components/schemas/StoryLine" } },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Lines created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/stories/{slug}/chapters/{chapterNo}/lines/{lineNo}": {
            put: {
                tags: ["Stories"],
                summary: "Update a line (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [
                    { name: "slug", in: "path", required: true, schema: { type: "string" } },
                    { name: "chapterNo", in: "path", required: true, schema: { type: "integer" } },
                    { name: "lineNo", in: "path", required: true, schema: { type: "integer" } },
                ],
                requestBody: {
                    content: { "application/json": { schema: { $ref: "#/components/schemas/StoryLine" } } },
                },
                responses: { "200": { description: "Updated line" }, "401": { description: "Unauthorized" } },
            },
        },
        "/items": {
            get: {
                tags: ["Items"],
                summary: "List all items",
                security: [], // public — no token needed
                parameters: [{ name: "search", in: "query", schema: { type: "string" } }],
                responses: { "200": { description: "Array of items" } },
            },
            post: {
                tags: ["Items"],
                summary: "Create an item lore entry",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["name", "itemType", "description"],
                                properties: {
                                    name: { type: "string" },
                                    itemType: { $ref: "#/components/schemas/ItemType" },
                                    description: { type: "string" },
                                    image: { type: "string" },
                                    slug: {
                                        type: "string",
                                        pattern: "^[a-z0-9]+(_[a-z0-9]+)*$",
                                        description: "Defaults to a slugified name",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Item created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/items/{id}": {
            get: {
                tags: ["Items"],
                summary: "Get an item by id, or by slug when the param isn't a bare integer",
                security: [], // public — no token needed
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "Numeric id or slug" }],
                responses: { "200": { description: "Item" }, "404": { description: "Not found" } },
            },
            put: {
                tags: ["Items"],
                summary: "Update an item (owner or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } },
                },
                responses: { "200": { description: "Updated item" }, "403": { description: "Forbidden" } },
            },
            delete: {
                tags: ["Items"],
                summary: "Delete an item (owner or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: { "204": { description: "Deleted" }, "403": { description: "Forbidden" } },
            },
        },
        "/8ball": {
            get: {
                tags: ["8-Ball"],
                summary: "Shake the 8-ball for a weighted-random answer (YES:NO:MAYBE = 2:1:1, renormalized over non-empty types)",
                security: [], // public — no token needed
                responses: {
                    "200": { description: "A random answer" },
                    "404": { description: "No answers configured" },
                },
            },
        },
        "/8ball/answers": {
            get: {
                tags: ["8-Ball"],
                summary: "List all 8-ball answers, ordered by type then id",
                security: [], // public — no token needed
                responses: { "200": { description: "Array of answers" } },
            },
            post: {
                tags: ["8-Ball"],
                summary: "Add a new 8-ball answer (any authenticated user)",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["type", "text"],
                                properties: {
                                    type: { $ref: "#/components/schemas/EightBallAnswerType" },
                                    text: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Answer created" },
                    "400": { description: "Validation error" },
                    "401": { description: "Unauthorized" },
                },
            },
        },
        "/8ball/answers/{id}": {
            delete: {
                tags: ["8-Ball"],
                summary: "Delete an 8-ball answer (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "204": { description: "Deleted" },
                    "401": { description: "Unauthorized" },
                    "403": { description: "Forbidden — not an admin" },
                    "404": { description: "Not found" },
                },
            },
        },
        "/search": {
            get: {
                tags: ["Search"],
                summary: "Unified keyword search across characters, items, transcript messages, and story lines, grouped by category",
                security: [], // public — no token needed
                parameters: [
                    { name: "q", in: "query", required: true, schema: { type: "string" } },
                    {
                        name: "limit",
                        in: "query",
                        schema: { type: "integer", default: 5, minimum: 1, maximum: 50 },
                        description: "Per-category result cap in grouped mode (self-clamped to 20 there); page size in single-category mode (clamped to 50)",
                    },
                    {
                        name: "category",
                        in: "query",
                        schema: { type: "string", enum: ["messages", "storyLines"] },
                        description: "When set, switches to paginated single-category mode ({data,total,page,limit}) instead of the grouped response — backs the dedicated search-results page",
                    },
                    {
                        name: "page",
                        in: "query",
                        schema: { type: "integer", default: 1, minimum: 1 },
                        description: "Only used when category is set",
                    },
                ],
                responses: {
                    "200": {
                        description: "Results grouped by category, or a paginated single category when ?category is set",
                        content: {
                            "application/json": { schema: { $ref: "#/components/schemas/SearchResults" } },
                        },
                    },
                    "400": { description: "Missing q" },
                },
            },
        },
    },
};

export default spec;
