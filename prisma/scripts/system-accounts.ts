// Accounts that exist only to own archive content, not people: they can never
// log in. Shared by seed-legacy.ts and flag-accounts-golive.ts.
//   - Archivist: authored the imported Vortox Machina chronicle
//   - FF 8 Ball: the Discord bot (the `bots` entry in archive-to-markdown's
//     meta/<season>.json files)
export const SYSTEM_ACCOUNTS = ["Archivist", "FF 8 Ball"];
