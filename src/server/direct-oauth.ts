/**
 * Native Auth0 RS256 resource-server verification for the existing Korean LAW
 * Express/Streamable-HTTP process. No public proxy hop and no external secret
 * forwarded. Opt-in only; old MCP_AUTH_TOKEN clients remain supported during
 * migration. JWKS source and resource origin are pinned, never user-supplied.
 */
import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto"

export const DIRECT_OAUTH_RESOURCE = "https://korean-law-mcp-ym.onrender.com"
export const DIRECT_OAUTH_ISSUER = "https://krx-dart-research.us.auth0.com/"
const MAX_JWT_CHARS = 16_000
const MAX_JWKS_CHARS = 64_000
const JWKS_TTL_MS = 300_000
const CLOCK_SKEW_SECONDS = 10

export interface DirectOAuthConfig {
  issuer: string
  resource: string
  audience: string
  allowedSubs: ReadonlySet<string>
  scope: "law:read"
}

export interface PublicJwk {
  kty: string
  kid?: string
  use?: string
  alg?: string
  n?: string
  e?: string
}

type JwksResolver = () => Promise<readonly PublicJwk[]>

export function readDirectOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): DirectOAuthConfig | null {
  const enabled = env.KOREAN_LAW_DIRECT_OAUTH ?? "0"
  if (enabled === "0") return null
  if (enabled !== "1") throw new Error("KOREAN_LAW_DIRECT_OAUTH must be 0 or 1")

  const issuer = env.OAUTH_ISSUER?.trim() ?? ""
  const audience = env.OAUTH_AUDIENCE?.trim() ?? ""
  const resource = env.MCP_RESOURCE_ID?.trim() ?? ""
  const allowedSubs = new Set((env.OAUTH_ALLOWED_SUBS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean))
  if (issuer !== DIRECT_OAUTH_ISSUER ||
      audience !== DIRECT_OAUTH_RESOURCE ||
      resource !== DIRECT_OAUTH_RESOURCE ||
      !allowedSubs.size ||
      [...allowedSubs].some(s => s === "*" || s.toLowerCase() === "all" ||
        s.toLowerCase() === "any" || s.length > 256)) {
    throw new Error("Korean LAW direct OAuth issuer, resource, audience or subject allowlist is invalid")
  }
  return { issuer, audience, resource, allowedSubs, scope: "law:read" }
}

export function protectedResourceMetadata(config: DirectOAuthConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.scope],
  }
}

export function oauthChallenge(config: DirectOAuthConfig): string {
  return "Bearer resource_metadata=\"" +
    config.resource + "/.well-known/oauth-protected-resource\", scope=\"" +
    config.scope + "\""
}

function decodeJwtPart(part: string): unknown {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("Invalid JWT encoding")
  const bytes = Buffer.from(part, "base64url")
  if (bytes.toString("base64url") !== part) throw new Error("Noncanonical JWT encoding")
  return JSON.parse(bytes.toString("utf8")) as unknown
}

function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x)
}

export function validateJwtClaims(
  claims: Record<string, unknown>, config: DirectOAuthConfig,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const aud = claims.aud
  const validAudience = aud === config.audience ||
    (Array.isArray(aud) && aud.includes(config.audience))
  const iat = claims.iat
  const exp = claims.exp
  const nbf = claims.nbf
  return claims.iss === config.issuer &&
    validAudience &&
    typeof claims.sub === "string" && config.allowedSubs.has(claims.sub) &&
    typeof claims.scope === "string" &&
      claims.scope.split(/\s+/).includes(config.scope) &&
    typeof iat === "number" && Number.isSafeInteger(iat) &&
      iat <= now + CLOCK_SKEW_SECONDS &&
    typeof exp === "number" && Number.isSafeInteger(exp) &&
      exp > now - CLOCK_SKEW_SECONDS && exp > iat &&
    (nbf === undefined ||
      (typeof nbf === "number" && Number.isSafeInteger(nbf) &&
       nbf <= now + CLOCK_SKEW_SECONDS))
}

/** Key cache is process-local. It deliberately refuses unknown kids until next
 * refresh instead of allowing random-kid JWT floods to force HTTP fetches. */
export function createDirectOAuthVerifier(
  config: DirectOAuthConfig,
  resolveJwks: JwksResolver = createPinnedJwksResolver(config),
): (jwt: string) => Promise<boolean> {
  return async (token: string): Promise<boolean> => {
    if (!token || token.length > MAX_JWT_CHARS) return false
    const parts = token.split(".")
    if (parts.length !== 3) return false
    try {
      const header = decodeJwtPart(parts[0])
      const claims = decodeJwtPart(parts[1])
      if (!isObject(header) || !isObject(claims) ||
          header.alg !== "RS256" ||
          typeof header.kid !== "string" || !/^[\w.-]{1,256}$/.test(header.kid) ||
          !validateJwtClaims(claims, config)) return false

      const keys = await resolveJwks()
      const eligible = keys.filter(jwk =>
        jwk.kid === header.kid && jwk.kty === "RSA" &&
        (jwk.use === undefined || jwk.use === "sig") &&
        (jwk.alg === undefined || jwk.alg === "RS256") &&
        typeof jwk.n === "string" && typeof jwk.e === "string")
      if (eligible.length !== 1) return false
      const publicKey = createPublicKey({
        key: eligible[0] as JsonWebKey, format: "jwk",
      })
      const signature = Buffer.from(parts[2], "base64url")
      if (!parts[2] || signature.toString("base64url") !== parts[2]) return false
      return verifySignature("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]),
        publicKey, signature)
    } catch {
      return false // Invalid JWT, expired credential, JWKS downtime: fail closed.
    }
  }
}

function createPinnedJwksResolver(config: DirectOAuthConfig): JwksResolver {
  const uri = config.issuer + ".well-known/jwks.json"
  let expiresAt = 0
  let cached: readonly PublicJwk[] = []
  let pending: Promise<readonly PublicJwk[]> | null = null

  return async () => {
    if (cached.length && Date.now() < expiresAt) return cached
    if (pending) return pending
    pending = (async () => {
      const response = await fetch(uri, {
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
        headers: { accept: "application/json" },
      })
      if (!response.ok ||
          !(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
        throw new Error("OAuth JWKS provider unavailable")
      }
      const raw = await response.text()
      if (raw.length > MAX_JWKS_CHARS) throw new Error("OAuth JWKS oversized")
      const parsed: unknown = JSON.parse(raw)
      if (!isObject(parsed) || !Array.isArray(parsed.keys) ||
          parsed.keys.length > 25) throw new Error("OAuth JWKS malformed")
      const keys = (parsed.keys as unknown[]).filter(
        (x): x is PublicJwk => isObject(x) && typeof x.kty === "string",
      )
      if (!keys.length) throw new Error("OAuth JWKS empty")
      cached = keys
      expiresAt = Date.now() + JWKS_TTL_MS
      return cached
    })()
    try {
      return await pending
    } finally {
      pending = null
    }
  }
}
