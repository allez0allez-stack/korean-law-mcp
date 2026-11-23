import http from "node:http"
import type { AddressInfo } from "node:net"
import { generateKeyPairSync, sign } from "node:crypto"
import express from "express"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { requestContext } from "../lib/session-state.js"
import { startHTTPServer } from "./http-server.js"

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const resource = "https://korean-law-mcp-ym.onrender.com"
const issuer = "https://krx-dart-research.us.auth0.com/"
const nativeFetch = globalThis.fetch.bind(globalThis)
const previousSignals = new Map<string, Set<Function>>()
let listener: http.Server
let endpoint = ""

function issueToken(changes: Record<string, unknown> = {}, alg = "RS256"): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg, kid: "test-key" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify({
    iss: issuer, aud: resource, sub: "auth0|allowed", scope: "law:read",
    iat: now - 1, exp: now + 600, ...changes,
  })).toString("base64url")
  const message = header + "." + payload
  return message + "." + sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url")
}

const rpc = (headers: Record<string, string> = {}) => nativeFetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...headers,
  },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "inspect", arguments: {} },
  }),
})

beforeAll(async () => {
  for (const name of ["SIGINT", "SIGTERM"]) previousSignals.set(name, new Set(process.listeners(name)))
  vi.stubEnv("MCP_HTTP_HOST", "127.0.0.1")
  vi.stubEnv("MCP_AUTH_TOKEN", "")
  vi.stubEnv("KOREAN_LAW_DIRECT_OAUTH", "1")
  vi.stubEnv("OAUTH_ISSUER", issuer)
  vi.stubEnv("OAUTH_AUDIENCE", resource)
  vi.stubEnv("MCP_RESOURCE_ID", resource)
  vi.stubEnv("OAUTH_ALLOWED_SUBS", "auth0|allowed")
  vi.stubEnv("CORS_ORIGIN", "")
  vi.stubEnv("ALLOWED_ORIGINS", "")
  vi.stubEnv("RATE_LIMIT_RPM", "0")
  vi.stubEnv("FALLBACK_RATE_LIMIT_RPM", "0")
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (typeof input === "string" && input === issuer + ".well-known/jwks.json") {
      return Promise.resolve(new Response(JSON.stringify({
        keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-key",
          alg: "RS256", use: "sig" }],
      }), { headers: { "content-type": "application/json" } }))
    }
    return nativeFetch(input, init)
  })
  const listen = express.application.listen
  vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Application, ...args: any[]) {
    listener = listen.apply(this, args as any)
    return listener
  })
  await startHTTPServer(() => {
    const s = new Server({ name: "oauth-test", version: "1" }, { capabilities: { tools: {} } })
    s.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: "text", text: JSON.stringify({ apiKey: requestContext.getStore()?.apiKey ?? null }) }],
    }))
    return s
  }, 0)
  if (!listener.listening) await new Promise<void>(resolve => listener.once("listening", resolve))
  endpoint = "http://127.0.0.1:" + (listener.address() as AddressInfo).port + "/mcp"
})

afterAll(async () => {
  listener?.closeAllConnections()
  if (listener) await new Promise<void>(resolve => listener.close(() => resolve()))
  for (const [name, previous] of previousSignals) {
    for (const handler of process.listeners(name)) {
      if (!previous.has(handler)) process.removeListener(name, handler)
    }
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("single-process authenticated Korean LAW MCP", () => {
  it("serves OAuth resource discovery from the same web process", async () => {
    const response = await nativeFetch(endpoint.replace("/mcp", "/.well-known/oauth-protected-resource"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      resource, authorization_servers: [issuer], scopes_supported: ["law:read"],
    })
  })

  it("returns 401 and the OAuth challenge before a law tool can execute", async () => {
    const response = await rpc()
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain("law:read")
  })

  it("validates JWT and keeps the OAuth bearer token out of the LAW_OC API-key context", async () => {
    const response = await rpc({
      authorization: "Bearer " + issueToken(),
      origin: "https://chatgpt.com",
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.result.content[0].text).toBe('{"apiKey":null}')
  })

  it("rejects forged JWT, wrong audience and wrong user before tool execution", async () => {
    for (const token of [
      "invalid",
      issueToken({ aud: "https://korean-law-oauth-mcp-ym.onrender.com" }),
      issueToken({ sub: "auth0|unapproved" }),
      issueToken({ scope: "law:write" }),
    ]) {
      expect((await rpc({ authorization: "Bearer " + token })).status).toBe(401)
    }
  })

  it("rejects untrusted browser origins even with a valid JWT", async () => {
    expect((await rpc({
      authorization: "Bearer " + issueToken(), origin: "https://attacker.example",
    })).status).toBe(403)
  })
})
