/**
 * Mandatory Docker-build HTTP integration gate for direct Auth0 access.
 * Only loopback traffic and in-memory JWKS are used; no external auth or LAW API.
 */
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import express from "express"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { startHTTPServer } from "../build/server/http-server.js"
import { requestContext } from "../build/lib/session-state.js"

const issuer = "https://krx-dart-research.us.auth0.com/"
const resource = "https://korean-law-mcp-ym.onrender.com"
Object.assign(process.env, {
  MCP_HTTP_HOST: "127.0.0.1",
  MCP_AUTH_TOKEN: "",
  KOREAN_LAW_DIRECT_OAUTH: "1",
  OAUTH_ISSUER: issuer,
  OAUTH_AUDIENCE: resource,
  MCP_RESOURCE_ID: resource,
  OAUTH_ALLOWED_SUBS: "auth0|QA-user",
  RATE_LIMIT_RPM: "0",
  FALLBACK_RATE_LIMIT_RPM: "0",
  CORS_ORIGIN: "",
  ALLOWED_ORIGINS: "",
})

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const oldFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (url, options) => {
  if (url === issuer + ".well-known/jwks.json") {
    return new Response(JSON.stringify({
      keys: [{ ...publicKey.export({ format: "jwk" }),
        kid: "QA-kid", use: "sig", alg: "RS256" }],
    }), { headers: { "content-type": "application/json" } })
  }
  return oldFetch(url, options)
}
const now = Math.floor(Date.now() / 1000)
const token = (change = {}) => {
  const payload = {
    iss: issuer, aud: resource, sub: "auth0|QA-user", scope: "law:read",
    iat: now - 1, exp: now + 600, ...change,
  }
  const message = Buffer.from(JSON.stringify({ kid: "QA-kid", alg: "RS256" })).toString("base64url") +
    "." + Buffer.from(JSON.stringify(payload)).toString("base64url")
  return message + "." + sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url")
}

const oldListen = express.application.listen
let listener
express.application.listen = function (...args) {
  listener = oldListen.apply(this, args)
  return listener
}
const oldSignals = new Map(["SIGINT", "SIGTERM"]
  .map(name => [name, new Set(process.listeners(name))]))
let cases = 0

try {
  await startHTTPServer(() => {
    const server = new Server(
      { name: "law-direct-oauth-check", version: "1" },
      { capabilities: { tools: {} } },
    )
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({ apiKey: requestContext.getStore()?.apiKey ?? null }),
      }],
    }))
    return server
  }, 0)
  if (!listener.listening) await new Promise(resolve => listener.once("listening", resolve))
  const base = "http://127.0.0.1:" + listener.address().port
  const metadata = await oldFetch(base + "/.well-known/oauth-protected-resource")
  assert.equal(metadata.status, 200)
  assert.equal((await metadata.json()).resource, resource)
  cases++

  const post = (headers = {}) => oldFetch(base + "/mcp", {
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
  const missing = await post()
  assert.equal(missing.status, 401)
  assert.match(missing.headers.get("www-authenticate") ?? "", /law:read/)
  cases++

  const wrongAudience = await post({
    authorization: "Bearer " + token({ aud: "https://other.example/" }),
  })
  assert.equal(wrongAudience.status, 401)
  cases++

  const wrongOrigin = await post({
    authorization: "Bearer " + token(), origin: "https://attacker.example",
  })
  assert.equal(wrongOrigin.status, 403)
  cases++

  const accepted = await post({
    authorization: "Bearer " + token(), origin: "https://chatgpt.com",
  })
  assert.equal(accepted.status, 200)
  const body = await accepted.json()
  assert.equal(body.result.content[0].text, '{"apiKey":null}')
  cases++
  console.log("KOREAN_LAW_DIRECT_OAUTH_HTTP_PASS", { cases })
} finally {
  if (listener) {
    listener.closeAllConnections()
    await new Promise(resolve => listener.close(resolve))
  }
  express.application.listen = oldListen
  globalThis.fetch = oldFetch
  for (const [name, old] of oldSignals) {
    for (const handler of process.listeners(name)) {
      if (!old.has(handler)) process.removeListener(name, handler)
    }
  }
}
