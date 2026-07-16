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
            SentienceClass: {
                type: "string",
                enum: ["BLACK", "HIGHER_SENTIENT", "LOWER_SENTIENT", "NON_SENTIENT"],
            },
            User: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    username: { type: "string" },
                    email: { type: "string", nullable: true },
                    role: { $ref: "#/components/schemas/UserRole" },
                    icon: { type: "string", nullable: true },
                    bio: { type: "string", nullable: true },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                },
            },
            Character: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                    speciesId: { type: "integer" },
                    image: { type: "string", nullable: true },
                    color: { type: "string", nullable: true },
                    blurb: { type: "string", nullable: true },
                    creatorId: { type: "integer" },
                    slug: { type: "string" },
                },
            },
            Species: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                    description: { type: "string" },
                    class: { $ref: "#/components/schemas/SentienceClass" },
                    creatorId: { type: "integer" },
                    slug: { type: "string" },
                },
            },
            Season: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    episodes: { type: "array", items: { $ref: "#/components/schemas/Episode" } },
                    slug: { type: "string" },
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
                },
            },
            Message: {
                type: "object",
                properties: {
                    episodeTitle: { type: "string" },
                    messageNo: { type: "integer" },
                    playerId: { type: "integer" },
                    characterId: { type: "integer", nullable: true },
                    timestamp: { type: "string", format: "date-time", nullable: true },
                    type: { $ref: "#/components/schemas/MessageType" },
                    text: { type: "string" },
                },
            },
            StoryLineType: {
                type: "string",
                enum: ["NARRATION", "DIALOGUE", "ACTION", "TRANSCRIPT", "BREAK", "HEADING"],
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
                    authorId: { type: "integer", nullable: true },
                    publishedDate: { type: "string", format: "date-time", nullable: true },
                    themeColor: { type: "string", nullable: true },
                    themeColor2: { type: "string", nullable: true },
                    format: { $ref: "#/components/schemas/StoryFormat" },
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
                    segments: {
                        type: "array",
                        nullable: true,
                        description: "Sub-paragraph dialogue spans (NARRATION lines only); concatenation equals text",
                        items: { $ref: "#/components/schemas/StorySegment" },
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
        },
    },
    paths: {
        "/register": {
            post: {
                tags: ["Auth"],
                summary: "Register a new user",
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
                },
            },
        },
        "/login": {
            post: {
                tags: ["Auth"],
                summary: "Log in and receive a JWT",
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
                },
            },
        },
        "/user": {
            get: {
                tags: ["Auth"],
                summary: "Get the authenticated user's profile",
                security: [{ bearerAuth: [] }],
                responses: {
                    "200": { description: "User profile" },
                    "401": { description: "Unauthorized" },
                },
            },
            put: {
                tags: ["Auth"],
                summary: "Update the authenticated user's profile",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    username: { type: "string" },
                                    icon: { type: "string" },
                                    bio: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Updated profile" },
                    "401": { description: "Unauthorized" },
                },
            },
        },
        "/users": {
            get: {
                tags: ["Auth"],
                summary: "List all users (admin only)",
                security: [{ bearerAuth: [] }],
                responses: {
                    "200": { description: "Array of users" },
                    "401": { description: "Unauthorized" },
                    "403": { description: "Forbidden — not an admin" },
                },
            },
        },
        "/users/{id}": {
            get: {
                tags: ["Auth"],
                summary: "Get a user's public profile by ID",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "200": { description: "User profile" },
                    "400": { description: "Invalid user ID" },
                    "401": { description: "Unauthorized" },
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
        "/characters": {
            get: {
                tags: ["Characters"],
                summary: "List all characters",
                parameters: [
                    { name: "search", in: "query", schema: { type: "string" }, description: "Search by name" },
                    { name: "speciesId", in: "query", schema: { type: "integer" } },
                    { name: "ownerId", in: "query", schema: { type: "integer" } },
                    { name: "season", in: "query", schema: { type: "string" } },
                ],
                responses: { "200": { description: "Array of characters" } },
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
                                required: ["name", "speciesId"],
                                properties: {
                                    name: { type: "string" },
                                    speciesId: { type: "integer" },
                                    image: { type: "string" },
                                    color: { type: "string" },
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
                },
            },
        },
        "/characters/{id}/quotes": {
            get: {
                tags: ["Characters", "Messages", "Stories"],
                summary: "Get quotes attributed to a character: transcript QUOTE messages and story-embedded dialogue",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "200": {
                        description: "{ messages: Message[], storyQuotes: StoryLine[] } — two arrays, no shared sort key between sources",
                    },
                },
            },
        },
        "/species": {
            get: {
                tags: ["Species"],
                summary: "List all species",
                parameters: [{ name: "search", in: "query", schema: { type: "string" } }],
                responses: { "200": { description: "Array of species" } },
            },
            post: {
                tags: ["Species"],
                summary: "Create a species",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["name", "description", "class"],
                                properties: {
                                    name: { type: "string" },
                                    description: { type: "string" },
                                    class: { $ref: "#/components/schemas/SentienceClass" },
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
                responses: { "201": { description: "Species created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/species/{id}": {
            get: {
                tags: ["Species"],
                summary: "Get a species by id or slug, including its characters",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "Numeric id or slug" }],
                responses: { "200": { description: "Species" }, "404": { description: "Not found" } },
            },
            put: {
                tags: ["Species"],
                summary: "Update a species (owner or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Species" } } },
                },
                responses: { "200": { description: "Updated species" }, "403": { description: "Forbidden" } },
            },
            delete: {
                tags: ["Species"],
                summary: "Delete a species (owner or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: { "204": { description: "Deleted" }, "403": { description: "Forbidden" } },
            },
        },
        "/seasons": {
            get: {
                tags: ["Seasons"],
                summary: "List all seasons",
                parameters: [{ name: "search", in: "query", schema: { type: "string" } }],
                responses: { "200": { description: "Array of seasons with episodes" } },
            },
            post: {
                tags: ["Seasons"],
                summary: "Create a season",
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
                parameters: [{ name: "title", in: "path", required: true, schema: { type: "string" } }],
                responses: { "200": { description: "Season" }, "404": { description: "Not found" } },
            },
            put: {
                tags: ["Seasons"],
                summary: "Rename a season (admin only)",
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
                parameters: [{ name: "search", in: "query", schema: { type: "string" } }],
                responses: { "200": { description: "Array of episodes" } },
            },
            post: {
                tags: ["Episodes"],
                summary: "Create an episode within a season",
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
                                        description: "Defaults to `<episode_no>_<slugified_title>`",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Episode created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/episodes/{title}": {
            get: {
                tags: ["Episodes"],
                summary: "Get an episode by title",
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
                parameters: [
                    { name: "episodeTitle", in: "path", required: true, schema: { type: "string" } },
                    { name: "messageNo", in: "path", required: true, schema: { type: "integer" } },
                ],
                responses: { "200": { description: "Message" }, "404": { description: "Not found" } },
            },
            put: {
                tags: ["Messages"],
                summary: "Update a message",
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
        "/quotes/random": {
            get: {
                tags: ["Messages"],
                summary: "Get a random QUOTE message",
                responses: { "200": { description: "A random quote" }, "404": { description: "No quotes found" } },
            },
        },
        "/stories": {
            get: {
                tags: ["Stories"],
                summary: "List all stories with chapter summaries",
                parameters: [{ name: "search", in: "query", schema: { type: "string" }, description: "Search title and blurb" }],
                responses: { "200": { description: "Array of stories" } },
            },
            post: {
                tags: ["Stories"],
                summary: "Create a story",
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
                                    authorId: { type: "integer" },
                                    publishedDate: { type: "string", format: "date-time" },
                                    themeColor: { type: "string" },
                                    themeColor2: { type: "string" },
                                    format: { $ref: "#/components/schemas/StoryFormat" },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Story created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/stories/{slug}": {
            get: {
                tags: ["Stories"],
                summary: "Get a story by slug with chapter summaries",
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
                summary: "Add a chapter (auto-numbered when chapter_no omitted)",
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
                summary: "Retitle a chapter",
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
                summary: "Bulk-append lines to a chapter",
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
                summary: "Update a line",
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
    },
};

export default spec;
