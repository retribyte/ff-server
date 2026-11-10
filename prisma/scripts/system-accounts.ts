// Accounts that exist only to own archive content, not people: they can never
// log in. Shared by seed-legacy.ts and flag-accounts-golive.ts.
//   - Archivist: authored the imported Vortox Machina chronicle
//   - 8 Ball (formerly "FF 8 Ball"): the Discord bot (the `bots` entry in archive-to-markdown's
//     meta/<season>.json files)
export const SYSTEM_ACCOUNTS = ["Archivist", "8 Ball"];
