import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalRedirectUrl, requestHost } from "../src/utils/canonical-host.js";

test("requestHost prefers the last X-Forwarded-Host entry, then Host", () => {
    assert.equal(requestHost("vortox.space", "127.0.0.1:41730"), "vortox.space");
    assert.equal(requestHost("evil.nfshost.com, vortox.space", "127.0.0.1:41730"), "vortox.space");
    assert.equal(requestHost(undefined, "Vortox.NFSHost.com:443"), "vortox.nfshost.com");
    assert.equal(requestHost(null, "127.0.0.1:41730"), "127.0.0.1");
    assert.equal(requestHost(null, null), null);
});

test("canonicalRedirectUrl sends nfshost.com and www to the canonical host", () => {
    const c = "vortox.space";
    assert.equal(canonicalRedirectUrl(c, "vortox.nfshost.com", "/api/seasons?x=1"), "https://vortox.space/api/seasons?x=1");
    assert.equal(canonicalRedirectUrl(c, "www.vortox.space", "/"), "https://vortox.space/");
    assert.equal(canonicalRedirectUrl(c, "vortox.space", "/api/seasons"), null);
    assert.equal(canonicalRedirectUrl(c, "127.0.0.1", "/api/seasons"), null); // the site's loopback calls
    assert.equal(canonicalRedirectUrl(c, "vortox.nfshost.com", "/.well-known/acme-challenge/x"), null);
    assert.equal(canonicalRedirectUrl(undefined, "vortox.nfshost.com", "/"), null); // dev: off
    assert.equal(canonicalRedirectUrl(c, null, "/"), null);
});
