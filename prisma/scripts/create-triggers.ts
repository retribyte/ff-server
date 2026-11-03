/**
 * Idempotent install of the hand-written integrity rules that schema.prisma
 * can't express. Same lifecycle as create-search-indexes.ts: wired into
 * `npm run seed`, and re-run after every `db push` as standard practice.
 * (`db push` drops foreign keys that aren't in the schema, but leaves
 * triggers and these indexes alone, so in practice a re-run is a no-op.)
 *
 * 1. messages_persona_match: a message's persona belongs to that message's
 *    character. NPC personas have characterId null, so an NPC line has
 *    characterId null too ("null == null", hence IS DISTINCT FROM). This
 *    replaces the old composite FK Message(personaId, characterId) ->
 *    Persona(id, characterId), which Postgres skips entirely whenever
 *    characterId is null (MATCH SIMPLE). assertPersonaMatchesCharacter in
 *    message.service.ts is the app-level mirror that gives a friendly error.
 * 2. personas_character_frozen: a persona that messages already use can't
 *    move to another character (or to/from NPC), which would silently break
 *    rule 1 for every one of those lines. Moving voices goes through
 *    src/speaker/speaker.service.ts, which re-points the messages instead.
 * 3. personas_npc_name_key: NPC personas are global and unique by
 *    case-insensitive name, so the FF2 and FF4 "Receptionist" share one
 *    nameplate. @@unique([characterId, name]) can't do it: NULLs are distinct.
 *
 * Postgres-specific. If prod ever runs on SQLite, this file is the only
 * thing to port.
 *
 * Run with: npm run db:triggers
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STATEMENTS = [
    `CREATE OR REPLACE FUNCTION messages_persona_match() RETURNS trigger AS $$
    BEGIN
        IF NEW."personaId" IS NOT NULL AND
           (SELECT "characterId" FROM personas WHERE id = NEW."personaId") IS DISTINCT FROM NEW."characterId" THEN
            RAISE EXCEPTION 'persona % does not belong to character %', NEW."personaId", coalesce(NEW."characterId"::text, 'null (NPC)')
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS messages_persona_match ON messages`,
    `CREATE TRIGGER messages_persona_match
        BEFORE INSERT OR UPDATE OF "personaId", "characterId" ON messages
        FOR EACH ROW EXECUTE FUNCTION messages_persona_match()`,

    `CREATE OR REPLACE FUNCTION personas_character_frozen() RETURNS trigger AS $$
    BEGIN
        IF NEW."characterId" IS DISTINCT FROM OLD."characterId" AND
           EXISTS (SELECT 1 FROM messages WHERE "personaId" = OLD.id) THEN
            RAISE EXCEPTION 'persona % is used by messages, so its character can''t change', OLD.id
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS personas_character_frozen ON personas`,
    `CREATE TRIGGER personas_character_frozen
        BEFORE UPDATE OF "characterId" ON personas
        FOR EACH ROW EXECUTE FUNCTION personas_character_frozen()`,

    `CREATE UNIQUE INDEX IF NOT EXISTS personas_npc_name_key ON personas (lower(name)) WHERE "characterId" IS NULL`,
];

async function main() {
    // One transaction, so a failure never leaves a trigger dropped.
    await prisma.$transaction(STATEMENTS.map((sql) => prisma.$executeRawUnsafe(sql)));
    console.log("Triggers OK: messages_persona_match, personas_character_frozen, personas_npc_name_key.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
