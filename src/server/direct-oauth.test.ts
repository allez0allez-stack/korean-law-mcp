import { generateKeyPairSync, sign } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  createDirectOAuthVerifier, oauthChallenge, protectedResourceMetadata,
  readDirectOAuthConfig, validateJwtClaims,
  type DirectOAuthConfig, type PublicJwk,
} from "./direct-oauth.js"

const env = {
  KOREAN_LAW_DIRECT_OAUTH: "1",
  OAUTH_ISSUER: "https://krx-dart-research.us.auth0.com/",
  OAUTH_AUDIENCE: "https://korean-law-mcp-ym.onrender.com",
  MCP_RESOURCE_ID: "https://korean-law-mcp-ym.onrender.com",
  OAUTH_ALLOWED_SUBS: "auth0|authorized-person",
}
const config = readDirectOAuthConfig(env)!
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" } as PublicJwk
const resolver = async () => [publicJwk]

const now = Math.floor(Date.now() / 1000)
function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: config.issuer, aud: config.audience, sub: "auth0|authorized-person",
    scope: "law:read", iat: now - 2, exp: now + 600, ...overrides,
  }
}
function jwt(payload: Record<string, unknown> = claims(),
             header: Record<string, unknown> = { alg: "RS256", kid: "test-key" }) {
  const unsigned = Buffer.from(JSON.stringify(header)).toString("base64url") +
    "." + Buffer.from(JSON.stringify(payload)).toString("base64url")
  return unsigned + "." + sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")
}

describe("direct Korean LAW OAuth resource server", () => {
  it("is opt-in and fail-closed for invalid enable values", () => {
    expect(readDirectOAuthConfig({})).toBeNull()
    expect(readDirectOAuthConfig({ KOREAN_LAW_DIRECT_OAUTH: "0" })).toBeNull()
    expect(() => readDirectOAuthConfig({ KOREAN_LAW_DIRECT_OAUTH: "true" })).toThrow()
    expect(() => readDirectOAuthConfig({ KOREAN_LAW_DIRECT_OAUTH: "1" })).toThrow()
  })

  it("pins original Auth0 issuer, direct audience and resource, nonwildcard subjects", () => {
    for (const [key, val] of [
      ["OAUTH_ISSUER", "https://attacker.example/"],
      ["OAUTH_AUDIENCE", "https://korean-law-oauth-mcp-ym.onrender.com"],
      ["MCP_RESOURCE_ID", "https://korean-law-oauth-mcp-ym.onrender.com"],
      ["OAUTH_ALLOWED_SUBS", "*"],
      ["OAUTH_ALLOWED_SUBS", "any"],
      ["OAUTH_ALLOWED_SUBS", ""],
    ]) {
      expect(() => readDirectOAuthConfig({ ...env, [key]: val })).toThrow()
    }
    expect(readDirectOAuthConfig(env)?.allowedSubs.has("auth0|authorized-person")).toBe(true)
  })

  it("provides correct protected-resource discovery and WWW-Authenticate challenge", () => {
    expect(protectedResourceMetadata(config)).toEqual({
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: ["law:read"],
    })
    expect(oauthChallenge(config)).toContain('scope="law:read"')
    expect(oauthChallenge(config)).toContain('/.well-known/oauth-protected-resource')
  })

  it("accepts a correctly signed RS256 scoped token with pinned audience", async () => {
    expect(await createDirectOAuthVerifier(config, resolver)(jwt())).toBe(true)
    expect(await createDirectOAuthVerifier(config, resolver)(jwt(claims({ scope: "foo law:read bar" })))).toBe(true)
  })

  it("rejects wrong audience, issuer, missing scope, user, future NBF or expired token", async () => {
    const verify = createDirectOAuthVerifier(config, resolver)
    for (const bad of [
      { iss: "https://attacker.example/" },
      { aud: "https://korean-law-oauth-mcp-ym.onrender.com" },
      { sub: "auth0|unapproved" },
      { scope: "law:write" }, { scope: "notlaw:read" },
      { exp: now - 30 }, { iat: now + 100 },
      { nbf: now + 100 }, { exp: now - 5, iat: now + 50 },
    ]) expect(await verify(jwt(claims(bad)))).toBe(false)
  })

  it("rejects missing required expiry, issued-at and subject", async () => {
    const verify = createDirectOAuthVerifier(config, resolver)
    for (const key of ["exp", "iat", "sub", "scope", "aud", "iss"]) {
      const c = claims()
      delete (c as Record<string, unknown>)[key]
      expect(await verify(jwt(c))).toBe(false)
    }
  })

  it("rejects forged, mismatched, unknown-kid, alg none and HMAC tokens", async () => {
    const verify = createDirectOAuthVerifier(config, resolver)
    const valid = jwt()
    expect(await verify(valid.slice(0, -4) + "aaaa")).toBe(false)
    expect(await verify(jwt(claims(), { alg: "none", kid: "test-key" }))).toBe(false)
    expect(await verify(jwt(claims(), { alg: "HS256", kid: "test-key" }))).toBe(false)
    expect(await verify(jwt(claims(), { alg: "RS256", kid: "random-key" }))).toBe(false)
  })

  it("rejects JWKS resolution failures, ambiguous keys, oversized or malformed tokens", async () => {
    const verify = createDirectOAuthVerifier(config, resolver)
    const down = createDirectOAuthVerifier(config, async () => { throw new Error("unavailable") })
    const ambiguous = createDirectOAuthVerifier(config, async () => [publicJwk, publicJwk])
    expect(await down(jwt())).toBe(false)
    expect(await ambiguous(jwt())).toBe(false)
    expect(await verify("a.b.c")).toBe(false)
    expect(await verify("x".repeat(17_000))).toBe(false)
    expect(await verify(jwt() + ".x")).toBe(false)
  })

  it("rejects valid signatures when issuer or signature algorithm is not trusted", async () => {
    const { privateKey: foreignKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const message = jwt().split(".").slice(0, 2).join(".")
    const forged = message + "." + sign("RSA-SHA256", Buffer.from(message), foreignKey).toString("base64url")
    expect(await createDirectOAuthVerifier(config, resolver)(forged)).toBe(false)
  })

  it("keeps claim validation independently testable with strict timestamps", () => {
    expect(validateJwtClaims(claims(), config as DirectOAuthConfig, now)).toBe(true)
    expect(validateJwtClaims(claims({ exp: "tomorrow" }), config, now)).toBe(false)
    expect(validateJwtClaims(claims({ iat: now + 99 }), config, now)).toBe(false)
  })
})
