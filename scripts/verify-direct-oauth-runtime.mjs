/**
 * Docker-build QA for direct Auth0 JWT verification, using only Node.js core.
 * No network requests, credentials, Vitest or optional native binaries needed.
 * Executed AFTER npm run build and BEFORE npm prune in the production image.
 */
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import {
  DIRECT_OAUTH_RESOURCE, DIRECT_OAUTH_ISSUER, createDirectOAuthVerifier,
  readDirectOAuthConfig, oauthChallenge, protectedResourceMetadata,
} from "../build/server/direct-oauth.js"

const env = {
  KOREAN_LAW_DIRECT_OAUTH: "1",
  OAUTH_ISSUER: DIRECT_OAUTH_ISSUER,
  OAUTH_AUDIENCE: DIRECT_OAUTH_RESOURCE,
  MCP_RESOURCE_ID: DIRECT_OAUTH_RESOURCE,
  OAUTH_ALLOWED_SUBS: "auth0|QA-user",
}
const config = readDirectOAuthConfig(env)
assert(config)
assert.equal(readDirectOAuthConfig({}), null)
for (const [key, value] of [
  ["OAUTH_ISSUER", "https://untrusted.example/"],
  ["OAUTH_AUDIENCE", "https://korean-law-oauth-mcp-ym.onrender.com"],
  ["MCP_RESOURCE_ID", "https://untrusted.example"],
  ["OAUTH_ALLOWED_SUBS", "*"],
  ["OAUTH_ALLOWED_SUBS", ""],
]) assert.throws(() => readDirectOAuthConfig({ ...env, [key]: value }))
assert.equal(protectedResourceMetadata(config).resource, DIRECT_OAUTH_RESOURCE)
assert.match(oauthChallenge(config), /law:read/)

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const kid = "QA-kid"
const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" }
let jwksCalls = 0
const verifier = createDirectOAuthVerifier(config, async () => {
  jwksCalls++
  return [jwk]
})
const now = Math.floor(Date.now() / 1000)
const claims = (extras = {}) => ({
  iss: config.issuer, aud: config.audience, sub: "auth0|QA-user",
  scope: "law:read", iat: now - 5, exp: now + 600, ...extras,
})
const jwt = (payload = claims(), header = { kid, alg: "RS256" }) => {
  const unsigned = Buffer.from(JSON.stringify(header)).toString("base64url") +
    "." + Buffer.from(JSON.stringify(payload)).toString("base64url")
  return unsigned + "." +
    sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")
}

let cases = 0
async function verifyCase(token, expected) {
  assert.equal(await verifier(token), expected)
  cases++
}
await verifyCase(jwt(), true)
await verifyCase(jwt(claims({ scope: "other law:read" })), true)
for (const bad of [
  { iss: "https://wrong.example/" },
  { aud: "https://korean-law-oauth-mcp-ym.onrender.com" },
  { sub: "auth0|unapproved" },
  { scope: "law:write" },
  { iat: now + 100 },
  { exp: now - 50 },
  { nbf: now + 100 },
]) await verifyCase(jwt(claims(bad)), false)
await verifyCase(jwt(claims(), { kid, alg: "none" }), false)
await verifyCase(jwt(claims(), { kid, alg: "HS256" }), false)
await verifyCase(jwt(claims(), { kid: "unknown", alg: "RS256" }), false)
await verifyCase(jwt().slice(0, -5) + "aaaaa", false)
await verifyCase("a.b.c", false)
await verifyCase("x".repeat(17_000), false)
assert(jwksCalls >= 2)
const unreachable = createDirectOAuthVerifier(config, async () => {
  throw new Error("JWKS unavailable")
})
assert.equal(await unreachable(jwt()), false)
const duplicateKeys = createDirectOAuthVerifier(config, async () => [jwk, jwk])
assert.equal(await duplicateKeys(jwt()), false)
cases += 2
console.log("KOREAN_LAW_DIRECT_OAUTH_RUNTIME_PASS", { cases })
