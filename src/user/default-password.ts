/**
 * The default password a seeded (or admin-reset) account starts with: the
 * username, lowercased with whitespace removed, plus "123" ("8 Ball" ->
 * "ff8ball123"). Anyone who knows a username can work it out, by design:
 * players claim their accounts hands-off, and mustChangePassword makes them
 * pick their own on first login. So admin accounts never use it: the seed
 * gives them no such password in prod, and resetPassword refuses them.
 */
export function defaultPassword(username: string): string {
    return `${username.toLowerCase().replaceAll(/\s/g, "")}123`;
}
