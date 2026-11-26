# KOFIA official source retrieval evidence — 2026-11-26

## Verified route
- Publisher: 금융투자협회.
- Official version-specific URL: https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq=1820&seq=140
- Use existing Agent-Reach Research V4.2 research_read. Do not use public_page_read for this host (observed access restriction); do not relax authentication or network controls.
- First retrieve METADATA and confirm title, official final URL, document ID and returned source hash. Then use FULL with document_id, cursor=0, and DEEP budget; resume using next_cursor until the final page. Compare document ID, source hash, total_chunks and consecutive chunk IDs on every page. If a document changes, restart the capture. Do not mix historical versions.
- Actual run: 774 consecutive chunks, two FULL calls, 34 body article headings, 18/18 selected wording checks, eight attachment names only. Raw HTML bytes were not independently downloaded and rehashed; hashes were reported by the retrieval tool.
- Evidence: kofia-1820-page1.json, kofia-1820-page2.json, kofia-1820-manifest.json.
- Version identity and the 2026-11-13 effective date are supported by the extracted text. Latest-version completeness remains unverified because the official amendment list's HTML extraction omitted row data. A future query must rediscover the official version rather than assuming historySeq=1820 is always current.
- Keep association IPO eligibility, tax preference, and private fund contractual restrictions distinct. The selected evidence checks are structural/literal checks, not an independent legal gold dataset.

## Runtime handoff
Korean LAW MCP remains the first route for statutes, decrees, ministerial rules and government notices. If an association rule is missing, use the association's official version-specific URL through research_read. This is ChatGPT-orchestrated cross-MCP routing; it is not an autonomous server-to-server integration. No new service, credentials, or deployment configuration is needed for this route.

## Deployment boundary
PR #59 was merged but Render deployment dep-dc3s9m59el5s739g7kc0 remained update_in_progress when last checked. Its new EXTERNAL_SOURCE_REQUIRED marker was not observed in the live search. Startup logs confirm the process started but do not establish deployment completion. This evidence branch does not change production code and is not deployed.

## Remaining work
Verify the latest official amendment index through an accessible public route, retrieve the eight linked HWP attachments without guessing URLs, verify attachment content/version, and add independent legal test cases for IPO eligibility, allocation and subscription payment capacity. Do not report unavailable source text as verified.
