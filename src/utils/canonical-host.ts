/**
 * Canonical-host redirect. Production answers to CANONICAL_HOST (vortox.space)
 * through Cloudflare, whose rules (geoblock, AI-bot block) only see requests
 * sent to that name. NFSN also serves the site under its default name
 * (vortox.nfshost.com), which skips Cloudflare entirely, so requests arriving
 * by that name, or by www., get a 308 to the canonical host (same path and
 * query; 308 keeps the method and body). Unset CANONICAL_HOST (dev) = off.
 *
 * A copy of this logic lives in ff-site (src/lib/canonicalHost.ts); keep the
 * two in step.
 */

/**
 * The host the client asked for. Behind NFSN's proxy, Apache passes it in
 * X-Forwarded-Host and appends its own value after any the client sent, so
 * only the last entry is trustworthy. Without that header (a direct loopback
 * call from the site's server code), it's the Host header.
 */
export function requestHost(forwardedHost: string | null | undefined, host: string | null | undefined): string | null {
    const raw = forwardedHost ? forwardedHost.split(",").at(-1) : host;
    const name = raw?.trim().toLowerCase().replace(/:\d+$/, "");
    return name || null;
}

/** Where to send this request, or null to serve it here. */
export function canonicalRedirectUrl(canonical: string | null | undefined, host: string | null, pathAndQuery: string): string | null {
    if (!canonical || !host || host === canonical) return null;
    if (pathAndQuery.startsWith("/.well-known/acme-challenge/")) return null;
    if (host.endsWith(".nfshost.com") || host === `www.${canonical}`) return `https://${canonical}${pathAndQuery}`;
    return null;
}
