# Final Frontier — Unified Web Application

## Software Design Document (Requirements)

**Status:** Draft
**Document type:** Requirements / Software Design Description (SDD) — Sections 1–4 (Introduction, Stakeholders, Functional Requirements, Non-Functional Requirements). Implementation specifics (framework choices, schema DDL, endpoint shapes) are deliberately deferred to a separate Technical Design phase.

---

## 1. Introduction

### 1.1 Purpose

This document specifies the requirements for a new, small web application ("the System") that consolidates the user-facing responsibilities of three existing Final Frontier applications:

| Legacy app | Role today | Status |
|---|---|---|
| `ff-site` | React frontend serving a static archive of past campaign transcripts and an interactive CYOA experience. | Functional but isolated; data is bundled at build time. |
| `ff-server` | Express/Prisma/Postgres API skeleton intended to back the site with persistent users, characters, species, episodes, messages, and quotes. | Schema partially defined; only User and Character routes implemented. **Its existing schema is treated as the canonical, correct-but-incomplete baseline for this project.** |
| `vortox-bot` | Discord bot that runs the live tabletop game. | Substantially complete; its live-play responsibilities (combat, turn tracking, DoT, dice rolling, in-game character status) are explicitly **not** absorbed by the System. |

### 1.2 Vision

A single small web application that is the canonical home for the Final Frontier universe' **lore and archives**: it stores characters, species, locations, items (weapons, equipment, artifacts, etc. as lore entries), and quotes; it lets registered members create and edit those entities through a web UI; and it presents finished campaigns as a polished public archive that anyone can read.

### 1.3 Scope

#### In scope

- Web-based read access to the campaign archive (seasons, episodes, transcripts, CYOA).
- Web-based authoring and management of the lore entities defined in §4: characters (biographical fields only), species, locations, items (descriptive only), quotes.
- User accounts and a simple two-role permission model.
- A single relational database; the existing `ff-server` Prisma schema is the baseline.

#### Out of scope (explicit)

- **The live tabletop game.** Live combat, turn rotation, voice-channel integration, dice rolling at the table — these remain with whatever client runs live play.
- **In-game character status.** HP, shield, resistances, damage-over-time, incorporeal state, status effects, damage events. The System stores who a character *is*, not their current combat state.
- **Importing legacy data.** Migrating records from the `vortox-bot` MongoDB or from Discord is out of scope. The System starts empty (or seeded by hand). Authoring new content via the UI is the supported path.
- **Admin dashboard.** No bulk-management UI, no import jobs UI, no operator console. Admins use the same UI as members, plus the elevated edit rights described in §2.2.
- **Discord bot replacement.** The System exposes an API (§3.10) so that an external client *could* be built against it, but the bot itself is not a deliverable.
- **Real-time collaborative editing.**

### 1.4 Definitions

| Term | Meaning |
|---|---|
| **Episode** | One session/installment of a campaign, with an ordered transcript of messages. |
| **Season** | A grouping of episodes under one campaign arc (e.g. FF1, FF2, Vortox Machina). |
| **Character** | A persistent in-universe person/creature, owned by a user, with biographical attributes only. |
| **Species** | A taxonomic classification a character belongs to. |
| **Item** | A descriptive in-universe object (weapon, piece of equipment, artifact, etc.), classified by an `ItemType` field. The System records items as lore, not as combat mechanics. May optionally be associated with a character. |
| **Quote** | A `Message` of type `QUOTE`; requires a character speaker. Not a separate entity. |
| **GUY** | The in-universe time unit used for characters' dates of birth and episode timestamps. |
| **Transcript** | The ordered sequence of narrative blocks (narration, dialogue, action, embed) that make up an episode. |
| **CYOA** | "Choose Your Own Adventure" — a branching narrative format that the reader navigates by selecting actions. |

---

## 2. Stakeholders and User Roles

### 2.1 Personas

- **Visitor (unauthenticated).** A fan or newcomer who wants to read finished campaigns and explore the universe' lore.
- **Member (authenticated user).** Maintains their own characters and contributes lore entries (species, items, quotes).
- **Admin.** Site operator. Same UI as a member, plus the ability to edit/delete any record and change another user's role.

### 2.2 Roles and Permissions

The System SHALL define exactly two roles:

| Role | Capabilities |
|---|---|
| Member | Read all published content. Create entities and edit/delete entities they own. Edit their own profile. |
| Admin | All Member rights, plus edit/delete on any record, plus role assignment. |

Visitors (no account) MAY read all published content; they cannot create or edit anything.

Ownership of an entity (e.g. a character) SHALL grant edit/delete permissions to its creator independent of role.

---

## 3. Functional Requirements

Each requirement is identified by a stable ID for traceability. `MUST` / `SHOULD` / `MAY` follow RFC 2119 usage.

### 3.1 Accounts and Authentication

- **FR-AUTH-1** The System MUST support user registration with username, email, and password.
- **FR-AUTH-2** The System MUST support password-based login that yields an authenticated session.
- **FR-AUTH-3** The System MUST hash passwords using a recognized password-hashing function at rest.
- **FR-AUTH-4** A user MUST be able to view and edit their own profile (display name, avatar, bio).

### 3.2 Archive Browsing (read-only, public)

- **FR-ARC-1** A visitor MUST be able to browse a list of seasons.
- **FR-ARC-2** A visitor MUST be able to open a season and see the list of episodes belonging to it.
- **FR-ARC-3** A visitor MUST be able to open an episode and read its full transcript.
- **FR-ARC-4** Transcripts MUST render multiple block types: narration, character dialogue, action, and embedded media.
- **FR-ARC-5** Each line/block of a transcript MUST be individually addressable via a URL anchor for deep-linking.
- **FR-ARC-6** A visitor MUST be able to search within an episode's transcript.
- **FR-ARC-7** Characters mentioned in a transcript MUST render with their associated avatar/color.

### 3.3 CYOA Reader

- **FR-CYOA-1** The System MUST support viewing a special narrative type, "CYOA", composed of narration, dialogue, and selectable action blocks.

### 3.4 Character Management

- **FR-CHAR-1** A member MUST be able to create a character. Required field: name. Optional fields drawn from the existing `Character` model in the `ff-server` schema: aliases, species, sex, height, weight, hair color, eye color, place of birth, home planet, date of birth (in GUY), avatar image, theme color, description.
- **FR-CHAR-2** A character MUST belong to exactly one user (its creator/owner).
- **FR-CHAR-3** A character MUST be able to have zero or more aliases (per the existing `Alias` model).
- **FR-CHAR-4** A character MUST be able to record interpersonal relationships to other characters (per the existing `Relationship` model).
- **FR-CHAR-5** *Removed — Location entity is out of scope.*
- **FR-CHAR-6** *Removed — in-game status (HP, shield, resistances, status effects, DoT) is out of scope.*
- **FR-CHAR-7** A character page MUST display the character's biographical data, related quotes, and known relationships.
- **FR-CHAR-8** Editing a character MUST be restricted to its owner or an admin.
- **FR-CHAR-9** A character MUST be searchable by name and alias.
- **FR-CHAR-10** The System MUST list all characters with filter and pagination (by species, by owner, by season they appeared in).

### 3.5 Species

- **FR-SPC-1** A member MUST be able to create a species, populating the fields already defined on the existing `Species` model: name, binomial name, description, sentience class, typical lifespan in GUY, natural diet, habitat, place of origin.
- **FR-SPC-2** A species MUST be referencable from a character.
- **FR-SPC-3** A species page MUST list every character belonging to it.

### 3.6 Locations

*Removed — Location is out of scope.*

### 3.7 Items (lore entries)

- **FR-ITM-1** A member MUST be able to create an item as a descriptive lore entry: name, item type, description, optional image.
- **FR-ITM-2** The item type (`ItemType`) MUST be one of an enumerated set of values (e.g. `WEAPON`, `EQUIPMENT`, `ARTIFACT`, `OTHER`) and MUST be required on creation.
- **FR-ITM-3** An item MAY be optionally associated with a character (e.g. a weapon known to belong to that character). This association is not required.
- **FR-ITM-4** An item page MUST be readable by visitors; editing is restricted to the owner or an admin.
- **FR-ITM-5** Items MUST NOT carry combat mechanics (damage type, dice expression, miss rate, usage counters). Those concepts belong to the live-play tool, which is out of scope.

### 3.8 Episodes and Transcripts

- **FR-EP-1** An episode MUST hold an ordered sequence of messages; see §3.9 for the message model.

### 3.9 Messages

Messages are the core content unit of the System. Every message belongs to an episode.

- **FR-MSG-1** Each message MUST have: a sequence number, a timestamp, an author (user), an optional character speaker, a type, and a text body.
- **FR-MSG-2** The message type MUST be one of: `BOT_RESPONSE`, `COMMAND`, `QUOTE`, `ACTION`, `EMBED`, `OTHER`.
- **FR-MSG-3** The owner of an episode (and admins) MUST be able to insert, edit, reorder, and delete messages within it.
- **FR-MSG-4** A message of type `QUOTE` MUST have a character speaker (`characterId` required).
- **FR-MSG-5** Messages of type `QUOTE` MUST be queryable by character or returned at random.
- **FR-MSG-6** A character page MUST display all `QUOTE` messages attributed to that character.

### 3.10 External API

- **FR-API-1** The System MUST expose an authenticated HTTP API covering all read and write operations available in the UI.
- **FR-API-2** The API MUST authenticate non-browser clients via a token mechanism.
- **FR-API-3** Write operations MUST enforce the same role/ownership rules as the UI.
- **FR-API-4** The API MUST be versioned so external clients are not broken by schema evolution.

### 3.11 Search

- **FR-SR-1** The System MUST provide a global search across characters, items, species, and episode titles.
- **FR-SR-2** Search results MUST be filterable by entity type.

---

## 4. Data Requirements (logical, not physical)

This section captures the *entities* and *relationships* the System must represent. The existing `ff-server` Prisma schema is the authoritative starting point and is treated as correct but incomplete; this section names what is reused and what must be added.

### 4.1 Entities reused from the existing `ff-server` schema (no changes required to existing fields)

- **User** — credentials, profile fields, role enum.
- **Character** — biographical fields as currently defined; ownership via `creator`.
- **Alias** — name, character reference.
- **Relationship** — description, character reference.
- **Species** — full taxonomic record as currently defined.
- **Season** — grouping of episodes.
- **Episode** — title, season, episode number, messages.
- **Message** — sequence number, timestamps, author, optional character, type enum, text body.

### 4.2 Entities to be added

- **Item** — `name`, `itemType` (enum, required), `description`, `image` (optional). Optional association to a **Character**. **No** combat fields.

### 4.3 Fields to be added to existing entities

- `Character` — optional `image` (avatar URL) and optional `themeColor` if not already present; needed by FR-ARC-7 and FR-CHAR-7.
- `Episode` — `summary`, `playedDate` if not already present.

### 4.4 Relationships (including additions)

- A **User** owns many **Characters**; a Character has exactly one owner.
- A **Character** belongs to at most one **Species**; a Species has many Characters.
- A **Character** has many **Aliases** and many **Relationships**.
- A **Season** has many **Episodes**; an **Episode** has many **Messages** in a stable order.
- A **Message** is authored by a **User** and optionally spoken by a **Character**.
- A **User** owns many **Items** as a creator/author *(new)*.
- An **Item** MAY be associated with at most one **Character**; a Character MAY have many associated Items *(new)*.

### 4.5 Constraints

- Usernames and emails MUST be unique.
- `(owner, character name)` SHOULD be unique to prevent the same player owning two indistinguishable copies.
- Episode `(season, episode_number)` MUST be unique.
- Message `(episode, sequence_number)` MUST be unique and gap-tolerant (reordering is permitted).
- Deleting a User MUST NOT cascade-destroy their content; ownership SHOULD be reassignable or preserved as "orphaned".

---

## 5. Non-Functional Requirements

### 5.1 Usability

- **NFR-UX-1** Archive pages MUST be readable on mobile and desktop without horizontal scrolling at common viewport widths.
- **NFR-UX-2** The visual identity (theme, character colors, pixel-art outlining) of the legacy `ff-site` SHOULD be preserved where it serves the brand.
- **NFR-UX-3** A dark and a light theme MUST be available; the user's choice MUST persist across sessions.
- **NFR-UX-4** Long transcripts MUST remain responsive (virtualized rendering, lazy loading); the new System must not regress on the existing site's handling of multi-thousand-block episodes.

### 5.2 Performance

- **NFR-PERF-1** Listing endpoints (episodes, characters, weapons, etc.) MUST be paginated.
- **NFR-PERF-2** Loading an episode page MUST render its first viewport within a reasonable interaction budget (target: under ~2s on a typical connection); the rest of the transcript MAY stream/virtualize.
- **NFR-PERF-3** Search MUST return results in interactive time (target: under ~500ms server-side for typical corpora).

### 5.3 Security

- **NFR-SEC-1** All write endpoints MUST require authentication.
- **NFR-SEC-2** Role and ownership checks MUST be enforced server-side regardless of UI state.
- **NFR-SEC-3** User-submitted text in transcripts and descriptions MUST be sanitized for safe HTML rendering.
- **NFR-SEC-4** The System MUST NOT expose password hashes or session tokens via public read endpoints.
- **NFR-SEC-5** Secrets MUST be supplied via environment configuration, never committed.

### 5.4 Reliability and Data Integrity

- **NFR-REL-1** A single relational database MUST be the source of truth for all entities listed in §4.
- **NFR-REL-2** Schema changes MUST be managed by versioned migrations starting from the existing `ff-server` schema as the baseline.
- **NFR-REL-3** The System SHOULD support scheduled, off-site backups of the database.

### 5.5 Maintainability

- **NFR-MNT-1** The codebase MUST be two repositories covering frontend and backend; the legacy split into three independent repos is being collapsed.
- **NFR-MNT-2** The API contract MUST be documented (e.g. OpenAPI, Swagger).

### 5.6 Extensibility

- **NFR-EXT-1** Adding a new transcript message type SHOULD require changes only to a renderer registry on the frontend and a recognized type enum on the backend.
- **NFR-EXT-2** The API MUST be sufficient that a Discord-side client *could* be re-implemented against it without server-side changes, even though building such a client is not part of this project.

### 5.7 Accessibility

- **NFR-A11Y-1** The site SHOULD meet WCAG 2.1 AA for color contrast, keyboard navigation, and screen-reader labels on interactive elements.

### 5.8 Internationalization

- **NFR-I18N-1** Out of scope for v1.

---

## 6. Constraints and Assumptions

### 6.1 Technology Constraints (preferences, not requirements of this document)

The implementing team has expressed a preference for:
- React for the web frontend.
- Express or NestJS for the HTTP backend.
- PostgreSQL accessed via Prisma.

These are stack preferences for the Technical Design phase and do not change the requirements stated above.

### 6.2 Assumptions

- The existing `ff-server` Prisma schema is correct where it exists and is the starting point for the database. It is incomplete in the specific ways called out in §4.2 and §4.3.
- This is a **small** application. Solutions should match that scale: no operator dashboards, no bulk-import tooling, no multi-tenant guild scoping.
- Live tabletop play continues elsewhere; the System is a lore archive and authoring tool, not a game runner.
- The legacy `ff-site` static JSON files exist as a reference, but importing them automatically is out of scope. Content that needs to live in the new System is re-entered (or seeded by hand) through the UI/API.

### 6.3 Open Questions

- Should characters be transferable between users, or only reassignable by an admin?
- Should item ownership (who created the lore entry) be displayed publicly, or is it purely an audit field?

---

## 7. Acceptance / Done-ness Criteria for v1

The first release of the System is considered complete when:

1. A visitor can read any episode at a stable URL, and legacy `ff-site` URLs redirect to the new ones.
2. A registered member can create a character, edit it, give it aliases and relationships, attach it to a species, attach quotes to it, and view it on a public character page.
3. A registered member can create an item (with an item type), optionally associate it with a character, and view it on an item page.
4. A registered member can create a season and an episode, add transcript messages, and view it in the archive.
5. An external client authenticating with an API token can perform all of the above operations programmatically.
6. The site passes the non-functional bars in §5.1–§5.4 on a representative dataset.

---

## 8. Mapping Summary: Legacy → New System

For traceability. Each row is a responsibility currently held by a legacy app and where it lands in this document.

| Legacy responsibility | Legacy owner | New owner in this document |
|---|---|---|
| Render season/episode/transcript archives | `ff-site` | §3.2 Archive Browsing |
| CYOA interactive reader | `ff-site` | §3.3 CYOA Reader |
| User registration / login | `ff-server` | §3.1 Accounts |
| Character biographical CRUD | `ff-server` + `vortox-bot` (incompatible split) | §3.4 Character Management |
| Species CRUD | `ff-server` (schema only) | §3.5 Species |
| Episode + Message storage | `ff-server` (schema only) | §3.8 Episodes and Transcripts |
| Items (weapons, equipment, artifacts) as descriptive lore | `vortox-bot` (mechanical) | §3.7 Items (lore entries) |
| Locations | `vortox-bot` | **OUT OF SCOPE** |
| Quotes | `vortox-bot` + `ff-server` schema | §3.9 Messages (type `QUOTE`) |
| Lists / inventories | `vortox-bot` | **OUT OF SCOPE** for v1 |
| Live dice rolling, turn rotation, voice-channel joining, real-time DoT ticking | `vortox-bot` | **OUT OF SCOPE** — remains with the live-play tool. |
| In-game character status (HP, shield, resistances, status effects) | `vortox-bot` | **OUT OF SCOPE** |
| Damage application history | `vortox-bot` (implicit) | **OUT OF SCOPE** |
| Guild-scoped multi-tenancy | `vortox-bot` | **OUT OF SCOPE** (no multi-tenant model in the new System) |
| Importing legacy data from MongoDB or Discord | n/a | **OUT OF SCOPE** |
| Admin operator dashboard / bulk tooling | n/a | **OUT OF SCOPE** |
