# Korean LAW MCP — single-server Auth0 OAuth migration (2026-11-23)

## Goal and architecture

Existing ChatGPT connection:
ChatGPT → korean-law-oauth-mcp-ym (Python/Auth0) → public HTTPS
→ korean-law-mcp-ym (Node/Law).

Target: one existing Render service, no new public proxy:
ChatGPT → korean-law-mcp-ym (Node/Express direct Auth0 RS256 + legal MCP tools).

The existing Node legal application, legal source credentials, read-only tool contracts
and stateless MCP transport remain intact. Direct OAuth is opt-in and fails closed.
No disabling authentication, bypassing provider throttles or creating extra servers.

## Evidence gate 0: deploy inactive feature safely

- PR adds src/server/direct-oauth.ts and direct integration in
  src/server/http-server.ts. KOREAN_LAW_DIRECT_OAUTH=0 (default)
  preserves the current MCP_AUTH_TOKEN behavior.
- Docker build MUST pass:
  node scripts/verify-direct-oauth-runtime.mjs
  and node scripts/verify-direct-oauth-http.mjs.
- Do not activate direct auth before OAuth resource/audience and allowlist are set.

## Auth0 resource configuration (admin-only, no credentials in chat/GitHub)

The existing Auth0 tenant is retained; create/register a second API resource
for the new direct LAW endpoint (do not delete the gateway API before cutover).

- API Identifier / audience: https://korean-law-mcp-ym.onrender.com
- Signing algorithm: RS256; permission / scope law:read
- PKCE S256 and existing authorized ChatGPT public client policy
- One explicit authorized Auth0 user subject (sub), no wildcard
- Issuer: https://krx-dart-research.us.auth0.com/

In the existing Render service korean-law-mcp-ym only, set privately:
- KOREAN_LAW_DIRECT_OAUTH=1
- OAUTH_ISSUER=https://krx-dart-research.us.auth0.com/
- OAUTH_AUDIENCE=https://korean-law-mcp-ym.onrender.com
- MCP_RESOURCE_ID=https://korean-law-mcp-ym.onrender.com
- OAUTH_ALLOWED_SUBS=<the authorized Auth0 user sub>

The old MCP_AUTH_TOKEN and LAW_OC values must remain unchanged during
migration. Do NOT use the OAuth gateway's old audience as the new resource.
No OAuth tokens or law API keys are ever printed in evidence.

## Staged cutover to ChatGPT

1. Fetch direct /.well-known/oauth-protected-resource. It must return
   the new resource, existing issuer and law:read, without secrets.
2. Unauthenticated /mcp must return 401 and a WWW-Authenticate
   resource-metadata challenge. Invalid JWT (issuer, audience, signature,
   scope, sub, expiry) must be rejected with 401.
3. Update/create the existing ChatGPT connector's MCP endpoint to the
   existing legal server https://korean-law-mcp-ym.onrender.com/mcp
   and authorize against its new Auth0 resource. Changing an OAuth resource
   usually requires a connector reconnection. This must be confirmed by
   ChatGPT, never assumed from HTTP success.
4. Verify serial real calls (not just registered tools):
   discover_tools → search_law → get_law_text for 시행령 제260조,
   with the correct source name, issue/effective date and substantive excerpt.
5. Check upstream LAW API auth and reference citations without exposing LAW_OC.
6. Keep the old OAuth gateway running throughout acceptance and a rollback
   window. When the new endpoint is verified as fully functional, disable the
   old connector and retire the obsolete gateway only after user approval.

## Rollback

- Disable the new ChatGPT direct endpoint / reselect the old gateway app.
- Set KOREAN_LAW_DIRECT_OAUTH=0 on legal core if needed; keep
  the old shared MCP_AUTH_TOKEN unchanged. The new OAuth module becomes
  inert and legacy clients continue to work.
- Do not change Render plan, rotate Auth0 secrets or alter legal source APIs
  merely to perform the migration.

## Distinct limitation

Removing the second public Render ingress eliminates the failure mode
caused by the OAuth gateway independently calling the upstream public URL.
It does NOT guarantee the remaining server is never subject to a free-tier
ingress/DDoS protection 429. Confirm a real legal call before declaring fixed.
