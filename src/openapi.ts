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
            Sex: { type: "string", enum: ["MALE", "FEMALE", "OTHER", "UNSPECIFIED"] },
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
                    dob: { type: "integer", nullable: true, description: "Date of birth as Unix timestamp (GUY)" },
                    pob: { type: "string", nullable: true },
                    homePlanet: { type: "string", nullable: true },
                    speciesId: { type: "integer" },
                    sex: { $ref: "#/components/schemas/Sex" },
                    height: { type: "number", nullable: true },
                    weight: { type: "number", nullable: true },
                    hairColor: { type: "string", nullable: true },
                    eyeColor: { type: "string", nullable: true },
                    image: { type: "string", nullable: true },
                    themeColor: { type: "string", nullable: true },
                    blurb: { type: "string", nullable: true },
                    creatorId: { type: "integer" },
                    aliases: { type: "array", items: { $ref: "#/components/schemas/Alias" } },
                    relationships: { type: "array", items: { $ref: "#/components/schemas/Relationship" } },
                },
            },
            Alias: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                    characterId: { type: "integer" },
                },
            },
            Relationship: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    description: { type: "string" },
                    characterId: { type: "integer" },
                },
            },
            Species: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                    binomialName: { type: "string", nullable: true },
                    description: { type: "string" },
                    class: { $ref: "#/components/schemas/SentienceClass" },
                    lifespan: { type: "string" },
                    diet: { type: "string", nullable: true },
                    habitat: { type: "string", nullable: true },
                    placeOfOrigin: { type: "string", nullable: true },
                    creatorId: { type: "integer" },
                },
            },
            Season: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    episodes: { type: "array", items: { $ref: "#/components/schemas/Episode" } },
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
                    characterId: { type: "integer", nullable: true },
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
            CelestialBodyType: { type: "string", enum: ["STAR", "PLANET", "MOON"] },
            BodyComposition: { type: "string", enum: ["TERRESTRIAL", "GAS", "ICE"] },
            Galaxy: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    slug: { type: "string" },
                    name: { type: "string" },
                    description: { type: "string", nullable: true },
                    image: { type: "string", nullable: true },
                },
            },
            GalaxyDetail: {
                allOf: [
                    { $ref: "#/components/schemas/Galaxy" },
                    {
                        type: "object",
                        properties: {
                            systems: {
                                type: "array",
                                description: "Slim systems for the map: position + creator + the system's star color inputs",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "integer" },
                                        name: { type: "string" },
                                        xPos: { type: "number", nullable: true },
                                        yPos: { type: "number", nullable: true },
                                        creatorId: { type: "integer" },
                                        star: {
                                            type: "object",
                                            nullable: true,
                                            properties: {
                                                temperatureK: { type: "number", nullable: true },
                                                color: { type: "string", nullable: true },
                                            },
                                        },
                                    },
                                },
                            },
                            landmarks: { type: "array", items: { $ref: "#/components/schemas/Landmark" } },
                        },
                    },
                ],
            },
            StarSystem: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    galaxyId: { type: "integer" },
                    name: { type: "string" },
                    description: { type: "string", nullable: true },
                    xPos: { type: "number", nullable: true, description: "Normalized 0..1 map position" },
                    yPos: { type: "number", nullable: true },
                    creatorId: { type: "integer" },
                    wikiArticle: { type: "string", nullable: true },
                },
            },
            StarSystemDetail: {
                allOf: [
                    { $ref: "#/components/schemas/StarSystem" },
                    {
                        type: "object",
                        properties: {
                            creator: {
                                type: "object",
                                properties: { id: { type: "integer" }, username: { type: "string" } },
                            },
                            bodies: {
                                type: "array",
                                description: "Nested body tree — root is the STAR; each node carries a `children` array",
                                items: { $ref: "#/components/schemas/CelestialBody" },
                            },
                        },
                    },
                ],
            },
            CelestialBody: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    systemId: { type: "integer" },
                    parentId: { type: "integer", nullable: true },
                    type: { $ref: "#/components/schemas/CelestialBodyType" },
                    name: { type: "string" },
                    radiusKm: { type: "number" },
                    distance: {
                        type: "number",
                        nullable: true,
                        description: "Orbital distance from parent: AU for planets (from the star), km for moons (from the planet); null for stars",
                    },
                    composition: { $ref: "#/components/schemas/BodyComposition", nullable: true, description: "Planets/moons only" },
                    temperatureK: { type: "number", nullable: true, description: "Stars only; drives rendered color" },
                    color: { type: "string", nullable: true },
                    description: { type: "string", nullable: true },
                    wikiArticle: { type: "string", nullable: true },
                    children: { type: "array", items: { $ref: "#/components/schemas/CelestialBody" } },
                },
            },
            CelestialBodyInput: {
                type: "object",
                description: "One node of the whole-tree PUT payload (star, planet, or moon shape — see /systems/{id}/bodies).",
                required: ["name", "radiusKm"],
                properties: {
                    name: { type: "string" },
                    radiusKm: { type: "number", description: "Must be > 0" },
                    distance: { type: "number", description: "AU for planets, km for moons; omitted for the star" },
                    composition: { $ref: "#/components/schemas/BodyComposition" },
                    temperatureK: { type: "number", description: "Star only" },
                    color: { type: "string" },
                    description: { type: "string" },
                    wikiArticle: { type: "string" },
                },
            },
            Landmark: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    galaxyId: { type: "integer" },
                    name: { type: "string" },
                    description: { type: "string", nullable: true },
                    xPos: { type: "number" },
                    yPos: { type: "number" },
                    creatorId: { type: "integer" },
                    wikiArticle: { type: "string", nullable: true },
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
                    { name: "search", in: "query", schema: { type: "string" }, description: "Search by name or alias" },
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
                                required: ["name", "speciesId", "sex", "creatorId"],
                                properties: {
                                    name: { type: "string" },
                                    speciesId: { type: "integer" },
                                    sex: { $ref: "#/components/schemas/Sex" },
                                    creatorId: { type: "integer" },
                                    dob: { type: "string", description: "ISO date string" },
                                    pob: { type: "string" },
                                    homePlanet: { type: "string" },
                                    height: { type: "number" },
                                    weight: { type: "number" },
                                    hairColor: { type: "string" },
                                    eyeColor: { type: "string" },
                                    blurb: { type: "string" },
                                    aliases: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
                                    relationships: { type: "array", items: { type: "object", properties: { description: { type: "string" } } } },
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
                summary: "Get a character by id",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
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
                                required: ["name", "description", "class", "lifespan", "creatorId"],
                                properties: {
                                    name: { type: "string" },
                                    description: { type: "string" },
                                    binomialName: { type: "string" },
                                    class: { $ref: "#/components/schemas/SentienceClass" },
                                    lifespan: { type: "string" },
                                    diet: { type: "string" },
                                    habitat: { type: "string" },
                                    placeOfOrigin: { type: "string" },
                                    creatorId: { type: "integer" },
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
                summary: "Get a species by id, including its characters",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
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
                            schema: { type: "object", required: ["title"], properties: { title: { type: "string" } } },
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
                            schema: { type: "object", required: ["title"], properties: { title: { type: "string" } } },
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
                                    slug: { type: "string", pattern: "^[a-z0-9-]+$" },
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
                                required: ["name", "itemType", "description", "creatorId"],
                                properties: {
                                    name: { type: "string" },
                                    itemType: { $ref: "#/components/schemas/ItemType" },
                                    description: { type: "string" },
                                    image: { type: "string" },
                                    creatorId: { type: "integer" },
                                    characterId: { type: "integer" },
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
                summary: "Get an item by id",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
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
        "/galaxies": {
            get: {
                tags: ["Space"],
                summary: "List all galaxies",
                responses: { "200": { description: "Array of galaxies" } },
            },
            post: {
                tags: ["Space"],
                summary: "Create a galaxy (admin only)",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["slug", "name"],
                                properties: {
                                    slug: { type: "string" },
                                    name: { type: "string" },
                                    description: { type: "string" },
                                    image: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Galaxy created" }, "403": { description: "Forbidden — not an admin" } },
            },
        },
        "/galaxies/{slug}": {
            get: {
                tags: ["Space"],
                summary: "Get a galaxy by slug: slim systems (map position, creatorId, star color inputs) + landmarks",
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                responses: {
                    "200": { description: "Galaxy detail", content: { "application/json": { schema: { $ref: "#/components/schemas/GalaxyDetail" } } } },
                    "404": { description: "Not found" },
                },
            },
            put: {
                tags: ["Space"],
                summary: "Update galaxy metadata (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Galaxy" } } },
                },
                responses: { "200": { description: "Updated galaxy" }, "403": { description: "Forbidden — not an admin" } },
            },
            delete: {
                tags: ["Space"],
                summary: "Delete a galaxy (admin only)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                responses: { "204": { description: "Deleted" }, "403": { description: "Forbidden — not an admin" } },
            },
        },
        "/galaxies/{slug}/systems": {
            post: {
                tags: ["Space"],
                summary: "Create a system shell in a galaxy (creatorId taken from the token)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["name"],
                                properties: {
                                    name: { type: "string" },
                                    description: { type: "string" },
                                    xPos: { type: "number" },
                                    yPos: { type: "number" },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "System created (empty body tree)" }, "401": { description: "Unauthorized" } },
            },
        },
        "/galaxies/{slug}/landmarks": {
            post: {
                tags: ["Space"],
                summary: "Create a landmark in a galaxy (creatorId taken from the token)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["name", "xPos", "yPos"],
                                properties: {
                                    name: { type: "string" },
                                    description: { type: "string" },
                                    xPos: { type: "number" },
                                    yPos: { type: "number" },
                                    wikiArticle: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Landmark created" }, "401": { description: "Unauthorized" } },
            },
        },
        "/landmarks/{id}": {
            put: {
                tags: ["Space"],
                summary: "Update a landmark (creator or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Landmark" } } },
                },
                responses: { "200": { description: "Updated landmark" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } },
            },
            delete: {
                tags: ["Space"],
                summary: "Delete a landmark (creator or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: { "204": { description: "Deleted" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } },
            },
        },
        "/systems/{id}": {
            get: {
                tags: ["Space"],
                summary: "Get a system by id: full metadata, creator, and the nested body tree (star → planets → moons)",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    "200": { description: "System detail", content: { "application/json": { schema: { $ref: "#/components/schemas/StarSystemDetail" } } } },
                    "404": { description: "Not found" },
                },
            },
            put: {
                tags: ["Space"],
                summary: "Partial metadata update — name, description, wikiArticle, xPos/yPos (creator or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    name: { type: "string" },
                                    description: { type: "string" },
                                    wikiArticle: { type: "string" },
                                    xPos: { type: "number", description: "Normalized 0..1; click-to-place sends just xPos/yPos" },
                                    yPos: { type: "number" },
                                },
                            },
                        },
                    },
                },
                responses: { "200": { description: "Updated system" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } },
            },
            delete: {
                tags: ["Space"],
                summary: "Delete a system, cascading its body tree (creator or admin)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: { "204": { description: "Deleted" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } },
            },
        },
        "/systems/{id}/bodies": {
            put: {
                tags: ["Space"],
                summary: "Transactional whole-tree replace of a system's celestial bodies (creator or admin)",
                description:
                    "Body is `{ star: { ...CelestialBodyInput, temperatureK, planets: [{ ...CelestialBodyInput, composition, distance (AU), moons: [{ ...CelestialBodyInput, composition, distance (km) }] }] } }`. " +
                    "Validated before write: exactly one STAR root (`star` must be a single object, not an array or missing), every PLANET parents to the star, every MOON parents to a planet " +
                    "(a `moons` array directly on `star` is rejected), body names unique within the system, and radiusKm positive. Deletes and recreates all bodies in one transaction — body ids may change; the system id is stable.",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["star"],
                                properties: {
                                    star: {
                                        allOf: [
                                            { $ref: "#/components/schemas/CelestialBodyInput" },
                                            {
                                                type: "object",
                                                properties: {
                                                    temperatureK: { type: "number" },
                                                    planets: {
                                                        type: "array",
                                                        items: {
                                                            allOf: [
                                                                { $ref: "#/components/schemas/CelestialBodyInput" },
                                                                {
                                                                    type: "object",
                                                                    required: ["composition"],
                                                                    properties: {
                                                                        moons: { type: "array", items: { $ref: "#/components/schemas/CelestialBodyInput" } },
                                                                    },
                                                                },
                                                            ],
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "Updated system with the new nested body tree", content: { "application/json": { schema: { $ref: "#/components/schemas/StarSystemDetail" } } } },
                    "400": { description: "Invalid tree (wrong star count, bad parenting, duplicate names, non-positive radius, ...)" },
                    "403": { description: "Forbidden" },
                    "404": { description: "Not found" },
                },
            },
        },
    },
};

export default spec;
