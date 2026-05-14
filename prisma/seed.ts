import { PrismaClient, UserRole, Sex, Class, MessageType, ItemType } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
    // Clear existing data in reverse dependency order
    await prisma.item.deleteMany();
    await prisma.message.deleteMany();
    await prisma.episode.deleteMany();
    await prisma.season.deleteMany();
    await prisma.alias.deleteMany();
    await prisma.relationship.deleteMany();
    await prisma.character.deleteMany();
    await prisma.species.deleteMany();
    await prisma.user.deleteMany();

    // ── Users ─────────────────────────────────────────────────────────────
    const [admin, trey, alex] = await Promise.all([
        prisma.user.create({
            data: {
                username: "admin",
                email: "admin@finalfrontier.local",
                password: hashSync("admin123", 12),
                role: UserRole.ADMIN,
            },
        }),
        prisma.user.create({
            data: {
                username: "trey",
                email: "trey@finalfrontier.local",
                password: hashSync("trey123", 12),
                role: UserRole.USER,
            },
        }),
        prisma.user.create({
            data: {
                username: "alex",
                email: "alex@finalfrontier.local",
                password: hashSync("alex123", 12),
                role: UserRole.USER,
            },
        }),
    ]);

    // ── Species ───────────────────────────────────────────────────────────
    const [human, vortian, krell, voidWalker] = await Promise.all([
        prisma.species.create({
            data: {
                name: "Human",
                binomialName: "Homo sapiens",
                description: "Resilient and adaptable bipeds originating from the Sol system. Their tenacity makes them exceptional explorers and soldiers alike.",
                class: Class.HIGHER_SENTIENT,
                lifespan: "~80 GUY",
                diet: "Omnivore",
                habitat: "Temperate terrestrial worlds",
                placeOfOrigin: "Sol III (Earth)",
                creatorId: admin.id,
            },
        }),
        prisma.species.create({
            data: {
                name: "Vortian",
                binomialName: "Vortus intelligens",
                description: "Tall, silver-skinned intellectuals from the Vortus Cluster. Renowned across the galaxy for advances in xenobiology and quantum medicine.",
                class: Class.HIGHER_SENTIENT,
                lifespan: "~200 GUY",
                diet: "Photosynthetic supplement / light omnivore",
                habitat: "High-altitude crystalline worlds",
                placeOfOrigin: "Vortus Prime",
                creatorId: admin.id,
            },
        }),
        prisma.species.create({
            data: {
                name: "Krell",
                binomialName: "Krellus ferox",
                description: "Massive, stone-skinned brutes from the volcanic moon Char. Low sentience but fiercely loyal once bonded. Used historically as heavy labor and shock troops.",
                class: Class.LOWER_SENTIENT,
                lifespan: "~40 GUY",
                diet: "Carnivore",
                habitat: "Volcanic / extreme-heat environments",
                placeOfOrigin: "Char (moon of Gol IV)",
                creatorId: trey.id,
            },
        }),
        prisma.species.create({
            data: {
                name: "Void Walker",
                binomialName: null,
                description: "Entities of unclear origin that exist partially outside conventional space-time. Classified BLACK due to near-incomprehensible cognition and unknown motivations.",
                class: Class.BLACK,
                lifespan: "Unknown",
                diet: "Unknown",
                habitat: "Interstitial void / deep space",
                placeOfOrigin: "Unknown",
                creatorId: admin.id,
            },
        }),
    ]);

    // ── Characters ────────────────────────────────────────────────────────
    const [rix, sova, grak, whisper, maris] = await Promise.all([
        prisma.character.create({
            data: {
                name: "Commander Rix",
                dob: -378691200, // ~Year -12 GUY
                pob: "New Meridian Station, Outer Belt",
                homePlanet: "Earth",
                speciesId: human.id,
                sex: Sex.MALE,
                height: 1.88,
                weight: 92,
                hairColor: "Dark brown",
                eyeColor: "Steel grey",
                image: null,
                themeColor: "#2e6fad",
                creatorId: trey.id,
                aliases: { create: [{ name: "The Commander" }, { name: "Rix-7" }] },
                relationships: {
                    create: [
                        { description: "Commanding officer of Dr. Sova" },
                        { description: "Former colleague of Engineer Maris" },
                    ],
                },
            },
        }),
        prisma.character.create({
            data: {
                name: "Dr. Sova",
                dob: -504921600, // ~Year -16 GUY
                pob: "Vortus Prime, Crystal Spires District",
                homePlanet: "Vortus Prime",
                speciesId: vortian.id,
                sex: Sex.FEMALE,
                height: 2.1,
                weight: 70,
                hairColor: null,
                eyeColor: "Luminescent violet",
                image: null,
                themeColor: "#8a4fbf",
                creatorId: alex.id,
                aliases: { create: [{ name: "Sova" }, { name: "Doc" }] },
                relationships: {
                    create: [{ description: "Chief Medical Officer under Commander Rix" }],
                },
            },
        }),
        prisma.character.create({
            data: {
                name: "Grak",
                dob: -220752000,
                pob: "Char, Molten Flats",
                homePlanet: "Char",
                speciesId: krell.id,
                sex: Sex.MALE,
                height: 2.6,
                weight: 340,
                hairColor: null,
                eyeColor: "Amber",
                image: null,
                themeColor: "#c45e1a",
                creatorId: trey.id,
                aliases: { create: [{ name: "Grak the Unbroken" }] },
                relationships: {
                    create: [{ description: "Bonded heavy unit assigned to Commander Rix" }],
                },
            },
        }),
        prisma.character.create({
            data: {
                name: "The Whisper",
                dob: null,
                pob: null,
                homePlanet: null,
                speciesId: voidWalker.id,
                sex: Sex.UNSPECIFIED,
                height: null,
                weight: null,
                hairColor: null,
                eyeColor: "None / shifting void",
                image: null,
                themeColor: "#1a1a2e",
                creatorId: admin.id,
                aliases: { create: [{ name: "It" }, { name: "The Presence" }] },
                relationships: {
                    create: [{ description: "Entity of unknown allegiance; observed following the crew" }],
                },
            },
        }),
        prisma.character.create({
            data: {
                name: "Engineer Maris",
                dob: -346032000,
                pob: "Tethys Colony, Saturn Orbit",
                homePlanet: "Tethys Colony",
                speciesId: human.id,
                sex: Sex.OTHER,
                height: 1.72,
                weight: 68,
                hairColor: "Shaved / rust-red stubble",
                eyeColor: "Brown",
                image: null,
                themeColor: "#4aab6d",
                creatorId: alex.id,
                aliases: { create: [{ name: "Maris" }, { name: "Wrench" }] },
                relationships: {
                    create: [
                        { description: "Ship engineer, old acquaintance of Commander Rix" },
                        { description: "Maintains Grak's restraint harness" },
                    ],
                },
            },
        }),
    ]);

    // ── Seasons ───────────────────────────────────────────────────────────
    const [season1, vortoxMachina] = await Promise.all([
        prisma.season.create({ data: { title: "Final Frontier Season 1" } }),
        prisma.season.create({ data: { title: "Vortox Machina" } }),
    ]);

    // ── Episodes ──────────────────────────────────────────────────────────
    const [pilot, intoTheVoid, machinaRising] = await Promise.all([
        prisma.episode.create({
            data: {
                title: "Pilot",
                seasonTitle: season1.title,
                episode_no: 1,
                summary: "The crew of the Meridian assembles for the first time and receives their assignment: investigate a silent distress beacon deep in the Outer Belt.",
                playedDate: new Date("2022-03-15"),
            },
        }),
        prisma.episode.create({
            data: {
                title: "Into the Void",
                seasonTitle: season1.title,
                episode_no: 2,
                summary: "Following the coordinates from the beacon, the crew enters a region of space where their instruments fail — and they are not alone.",
                playedDate: new Date("2022-03-29"),
            },
        }),
        prisma.episode.create({
            data: {
                title: "Machina Rising",
                seasonTitle: vortoxMachina.title,
                episode_no: 1,
                summary: "A new arc begins. The derelict station Vortox-7 has come back online after 30 years of silence, and a fresh crew is dispatched to find out why.",
                playedDate: new Date("2023-01-10"),
            },
        }),
    ]);

    // ── Messages ──────────────────────────────────────────────────────────
    // Pilot messages
    await prisma.message.createMany({
        data: [
            { episodeTitle: pilot.title, message_no: 1,  playerId: admin.id,  characterId: null,       date: new Date("2022-03-15T18:00:00Z"), type: MessageType.BOT_RESPONSE, text: "Session started. Welcome to Final Frontier Season 1, Episode 1: Pilot." },
            { episodeTitle: pilot.title, message_no: 2,  playerId: trey.id,   characterId: rix.id,     date: new Date("2022-03-15T18:02:00Z"), type: MessageType.ACTION,       text: "Commander Rix steps onto the bridge of the Meridian and surveys his new crew with measured skepticism." },
            { episodeTitle: pilot.title, message_no: 3,  playerId: trey.id,   characterId: rix.id,     date: new Date("2022-03-15T18:03:00Z"), type: MessageType.QUOTE,        text: "I don't care where you're from or who sent you. On this ship, you follow my orders. That's the only thing keeping us alive out here." },
            { episodeTitle: pilot.title, message_no: 4,  playerId: alex.id,   characterId: sova.id,    date: new Date("2022-03-15T18:05:00Z"), type: MessageType.QUOTE,        text: "With respect, Commander — my loyalty is to the mission and to the wellbeing of this crew. That, I suspect, aligns perfectly with your orders." },
            { episodeTitle: pilot.title, message_no: 5,  playerId: trey.id,   characterId: grak.id,    date: new Date("2022-03-15T18:06:00Z"), type: MessageType.QUOTE,        text: "Grak follows." },
            { episodeTitle: pilot.title, message_no: 6,  playerId: alex.id,   characterId: maris.id,   date: new Date("2022-03-15T18:08:00Z"), type: MessageType.ACTION,       text: "Engineer Maris slides out from beneath the engine housing, grease to the elbows, and gives Rix a two-finger salute." },
            { episodeTitle: pilot.title, message_no: 7,  playerId: alex.id,   characterId: maris.id,   date: new Date("2022-03-15T18:09:00Z"), type: MessageType.QUOTE,        text: "She'll hold, Commander. Probably." },
            { episodeTitle: pilot.title, message_no: 8,  playerId: admin.id,  characterId: null,       date: new Date("2022-03-15T18:15:00Z"), type: MessageType.BOT_RESPONSE, text: "The Meridian clears the station dock. A long-dormant beacon signal resolves on the nav display: deep Outer Belt, sector 7-Gamma. No known habitation." },
            { episodeTitle: pilot.title, message_no: 9,  playerId: trey.id,   characterId: rix.id,     date: new Date("2022-03-15T18:16:00Z"), type: MessageType.COMMAND,      text: "!navigate sector-7G" },
            { episodeTitle: pilot.title, message_no: 10, playerId: admin.id,  characterId: null,       date: new Date("2022-03-15T18:16:30Z"), type: MessageType.BOT_RESPONSE, text: "Course set. ETA: 18 hours at current speed. No hazards flagged... yet." },
        ],
    });

    // Into the Void messages
    await prisma.message.createMany({
        data: [
            { episodeTitle: intoTheVoid.title, message_no: 1,  playerId: admin.id,  characterId: null,       date: new Date("2022-03-29T18:00:00Z"), type: MessageType.BOT_RESPONSE, text: "Session started. The Meridian drops out of drift travel. All instruments flicker." },
            { episodeTitle: intoTheVoid.title, message_no: 2,  playerId: alex.id,   characterId: maris.id,   date: new Date("2022-03-29T18:02:00Z"), type: MessageType.QUOTE,        text: "Sensors are lying. Either that or we're reading a fold in local space-time. Neither answer is good." },
            { episodeTitle: intoTheVoid.title, message_no: 3,  playerId: trey.id,   characterId: rix.id,     date: new Date("2022-03-29T18:04:00Z"), type: MessageType.QUOTE,        text: "Sova — is that beacon biological?" },
            { episodeTitle: intoTheVoid.title, message_no: 4,  playerId: alex.id,   characterId: sova.id,    date: new Date("2022-03-29T18:05:00Z"), type: MessageType.QUOTE,        text: "The signal carries markers I have never encountered. It is not Human. It is not Vortian. I cannot classify it." },
            { episodeTitle: intoTheVoid.title, message_no: 5,  playerId: admin.id,  characterId: whisper.id, date: new Date("2022-03-29T18:10:00Z"), type: MessageType.QUOTE,        text: "You should not have come here. And yet — here is exactly where you need to be." },
            { episodeTitle: intoTheVoid.title, message_no: 6,  playerId: trey.id,   characterId: grak.id,    date: new Date("2022-03-29T18:11:00Z"), type: MessageType.ACTION,       text: "Grak stands between the apparition and the rest of the crew, fists raised." },
            { episodeTitle: intoTheVoid.title, message_no: 7,  playerId: trey.id,   characterId: grak.id,    date: new Date("2022-03-29T18:11:30Z"), type: MessageType.QUOTE,        text: "Thing does not touch crew." },
            { episodeTitle: intoTheVoid.title, message_no: 8,  playerId: admin.id,  characterId: null,       date: new Date("2022-03-29T18:20:00Z"), type: MessageType.BOT_RESPONSE, text: "The entity vanishes. Instruments restore. At the center of the anomaly, long-range scan resolves a derelict hull — registry unknown." },
            { episodeTitle: intoTheVoid.title, message_no: 9,  playerId: trey.id,   characterId: rix.id,     date: new Date("2022-03-29T18:21:00Z"), type: MessageType.QUOTE,        text: "Maris, I need a boarding tube ready in ten minutes. Grak — you're on point." },
            { episodeTitle: intoTheVoid.title, message_no: 10, playerId: alex.id,   characterId: maris.id,   date: new Date("2022-03-29T18:22:00Z"), type: MessageType.ACTION,       text: "Maris starts running, already pulling tools off her belt." },
        ],
    });

    // Machina Rising messages
    await prisma.message.createMany({
        data: [
            { episodeTitle: machinaRising.title, message_no: 1,  playerId: admin.id,  characterId: null,    date: new Date("2023-01-10T19:00:00Z"), type: MessageType.BOT_RESPONSE, text: "Session started. Welcome to Vortox Machina, Episode 1: Machina Rising." },
            { episodeTitle: machinaRising.title, message_no: 2,  playerId: admin.id,  characterId: null,    date: new Date("2023-01-10T19:01:00Z"), type: MessageType.EMBED,        text: "https://finalfrontier.local/assets/vortox-station-exterior.png" },
            { episodeTitle: machinaRising.title, message_no: 3,  playerId: admin.id,  characterId: null,    date: new Date("2023-01-10T19:02:00Z"), type: MessageType.BOT_RESPONSE, text: "Vortox Station 7. Designation: Research and Containment. Operational status: OFFLINE for 30 years. Current status: all systems nominal. No authorized crew aboard." },
            { episodeTitle: machinaRising.title, message_no: 4,  playerId: trey.id,   characterId: rix.id,  date: new Date("2023-01-10T19:05:00Z"), type: MessageType.QUOTE,        text: "Whatever woke it up, it didn't do it by accident." },
            { episodeTitle: machinaRising.title, message_no: 5,  playerId: alex.id,   characterId: sova.id, date: new Date("2023-01-10T19:07:00Z"), type: MessageType.ACTION,       text: "Dr. Sova connects a diagnostic probe to the station's outer data port and begins pulling 30 years of compressed logs." },
            { episodeTitle: machinaRising.title, message_no: 6,  playerId: alex.id,   characterId: sova.id, date: new Date("2023-01-10T19:09:00Z"), type: MessageType.QUOTE,        text: "There are 14,000 log entries from the last 72 hours alone. The station did not simply wake up — something woke it." },
        ],
    });

    // ── Items ──────────────────────────────────────────────────────────────
    await Promise.all([
        prisma.item.create({
            data: {
                name: "Plasma Rifle Mk. IV",
                itemType: ItemType.WEAPON,
                description: "Standard-issue long-arm of the Outer Belt Expeditionary Forces. Fires superheated plasma bolts with moderate range and excellent armor penetration. Rix keeps his in meticulously maintained condition.",
                image: null,
                creatorId: trey.id,
                characterId: rix.id,
            },
        }),
        prisma.item.create({
            data: {
                name: "Vortian Field Medkit",
                itemType: ItemType.EQUIPMENT,
                description: "A compact, multi-species trauma kit developed from Vortian xenobiology research. Contains nanite applicators, a tissue re-knitter, and synthetic blood compounds compatible with twelve known species.",
                image: null,
                creatorId: alex.id,
                characterId: sova.id,
            },
        }),
        prisma.item.create({
            data: {
                name: "Void Crystal Shard",
                itemType: ItemType.ARTIFACT,
                description: "A fragment of crystallized interstitial matter recovered from the anomaly in Sector 7-Gamma. Emits faint energy readings on no known frequency. Dr. Sova has been unable to determine its composition.",
                image: null,
                creatorId: admin.id,
                characterId: null,
            },
        }),
        prisma.item.create({
            data: {
                name: "Krell Bonding Chains",
                itemType: ItemType.EQUIPMENT,
                description: "Heavy restraint harness originally used to transport bonded Krell units. Grak wears his voluntarily — a symbol of the oath sworn to Commander Rix, and a reminder that his strength is chosen, not compelled.",
                image: null,
                creatorId: trey.id,
                characterId: grak.id,
            },
        }),
        prisma.item.create({
            data: {
                name: "Neural Splice Wrench",
                itemType: ItemType.EQUIPMENT,
                description: "Maris's custom multi-function tool: part mechanical wrench, part neural interface probe. Can interface with most pre-GUY-40 ship architectures. The 'wrench' nickname stuck when she used it to cold-start the Meridian's engine with three minutes to spare.",
                image: null,
                creatorId: alex.id,
                characterId: maris.id,
            },
        }),
        prisma.item.create({
            data: {
                name: "Meridian Navigation Core",
                itemType: ItemType.ARTIFACT,
                description: "The original navigation core salvaged from the first-generation Meridian-class vessel. Considered obsolete but Rix refuses to replace it — it has never plotted a wrong course.",
                image: null,
                creatorId: admin.id,
                characterId: null,
            },
        }),
    ]);

    console.log("Seed complete.");
    console.log(`  Users:      ${[admin, trey, alex].length}`);
    console.log(`  Species:    ${[human, vortian, krell, voidWalker].length}`);
    console.log(`  Characters: ${[rix, sova, grak, whisper, maris].length}`);
    console.log(`  Seasons:    ${[season1, vortoxMachina].length}`);
    console.log(`  Episodes:   ${[pilot, intoTheVoid, machinaRising].length}`);
    console.log(`  Items:      6`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
