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
                    message_no: { type: "integer" },
                    playerId: { type: "integer" },
                    characterId: { type: "integer", nullable: true },
                    timestamp: { type: "string", format: "date-time", nullable: true },
                    type: { $ref: "#/components/schemas/MessageType" },
                    text: { type: "string" },
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
                tags: ["Characters", "Messages"],
                summary: "Get all QUOTE messages attributed to a character",
                parameters: [{ name: "characterId", in: "path", required: true, schema: { type: "integer" } }],
                responses: { "200": { description: "Array of quote messages" } },
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
    },
};

export default spec;
