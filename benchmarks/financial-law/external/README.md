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
PR #59 Render deployment dep-dc3s9m59el5s739g7kc0 is LIVE, finished 2026-11-26T05:48:35Z, commit 8a112390244e27fe402d88b06cef60db8a5252e8. General and history KOFIA search both preserve NOT_FOUND and return EXTERNAL_SOURCE_REQUIRED; FSS rule search still succeeds. This evidence-only branch does not change production code and requires no redeploy.

## Remaining work
Verify the latest official amendment index through an accessible public route, retrieve the eight linked HWP attachments without guessing URLs, verify attachment content/version, and add independent legal test cases for IPO eligibility, allocation and subscription payment capacity. Do not report unavailable source text as verified.


## Version comparison and coverage — follow-up

- Official previous version: https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq=1782&seq=140
- March 12 amendment, effective March 13, 2026: 696/696 sequential chunks, two FULL calls, 28 recognized body article headings, seven attachment names.
- November 12 amendment, effective November 13, 2026: 774/774 sequential chunks, two FULL calls, 34 recognized body article headings, eight attachment names.
- `compare-kofia.mjs` indexes the two captures and compares exact normalized article text (whitespace normalized, chapter headings excluded, amendment annotations retained). Recognized headings: six new, seven changed, 21 unchanged, zero removed. Unrecognized/deleted heading formats are not a claim of legal absence. Latest addendum confirms three specified changes for first filings from 2027-01-01. Attachment body comparison not performed.
- Actual negative validation: six of six rejected (missing page, mixed version, reversed order, changed reported hash, duplicate chunk, incomplete final page). Initial execution used a URL constructor unavailable in the execution environment; replaced it with an exact known official version URL comparison and reran.
- `kofia-1782-to-1820-diff.json` contains indexed evidence ranges and actual validation results. Reproduce from this directory:
```sh
node compare-kofia.mjs 1782 1820 kofia-1782-page1.json kofia-1782-page2.json kofia-1820-page1.json kofia-1820-page2.json
```
- Latest-version evidence: official homepage and amendment-list search index display the 2026-11-12 revision, and the official version body confirms it. However, a separate opened amendment-list page returned an older 2026-07-30 snapshot, while Agent-Reach extraction returned no list rows. Therefore status is latest-observed version, not exhaustive live latest-version verification. Do not assume the fixed version ID remains current.
- Attachment evidence: official forms index search results corroborate the November 12 version and names of Annex 1, Annex 1-2, Annex 2 and Form 1. The opened list was an older snapshot, and direct text extraction omitted downloadable URLs. All eight attachment bodies remain UNVERIFIED. No guessed download URLs or requests to unverified endpoints.
- FSS guide: official index search found the 2026-05-01 preparation standard (https://dart.fss.or.kr/dsaa003/selectGuideMain.ax?seqno=443), but direct web fetch returned 502 and Agent-Reach returned route_required for DART. Dedicated DART filing tools are not general guide-attachment download tools. Latest version and attached PDFs remain UNVERIFIED.
- No new server, authentication, allowlist change, paid Exa, or manual Actions. This is evidence/data and an offline comparator; existing production regression count 1853 is unchanged and not rerun in this evidence-only step.


## Attachment coverage and local inspection — 2026-11-26

`attachment-coverage-20261126.json` maps all eight listed HWP files of historySeq=1820 to references in the already captured official body. Annex 1/1-2 regulate sanctions, Annex 2 due diligence, and five forms relate to Articles 6, 10, 17, 18 and 5. References are not annex text. All eight remain LISTED_ONLY: official file URLs were not recovered. The forms search index corroborates the version and first four filenames; it does not expose binary content. Direct web page returned cache miss, local DNS resolution failed, and the direct container downloader also failed. FSS guide seqno=443 lists five PDFs but returned HTTP 502 on direct access; the latest version is unverified. No guessed URL was requested.

`inspect_attachment.py` is an offline, local-file inspection utility. With trusted publisher files, run:
```sh
python inspect_attachment.py /path/to/file.pdf
python inspect_attachment.py /path/to/file.hwp
python -m unittest -v test_inspect_attachment
```
PDF requires pdftotext; HWP5 requires hwp5txt (not installed in this environment). Tests require reportlab for synthetic PDFs. Actual tests 8/8 passed (0.098 s): two-page PDF text and raw SHA-256, blank PDF, corrupt PDF, disguised HTML error, missing file, byte cap, invalid HWP signature and missing HWP parser. HWP extraction success has NOT been tested; no actual HWP or FSS PDF was obtained. Input limit 32 MiB, timeout 30 s, post-extraction output limit 2 million characters. The output byte cap is checked after extraction; this is not a hardened sandbox for arbitrary untrusted documents. Run only in a suitably isolated local environment with trusted files and maintained extractors. Source, version, visual layout, page/table completeness and legal effect are not verified by successful text extraction. Never use synthetic fixture values as legal evidence.

Local tested blob SHAs: inspect_attachment.py c98aa6b2e4df2c97059344852030e6ddd48c8433; test_inspect_attachment.py 5dc01f8d505a425c93c9f9f8ea8e63008b9d6a18. No runtime change, server creation, credential change or manual Actions. Existing 1853 production regression tests were not rerun in this evidence-only step.


## Fixed-source date predicate checks — 2026-11-26

While official attachment download remains blocked, eight selected explicit date predicates from the captured historySeq=1820 addenda were indexed in `kofia-date-boundaries-1820.json`. The date-only comparator validates captured page continuity, document identifiers, reported source hash and selected evidence wording. Actual JavaScript execution passed 36/36 checks: 24 boundary checks, eight wrong-event checks, three invalid-date checks and one wrong-source-hash check. These are synthetic dates tested against manually selected source predicates, not independent legal adjudication. The manifest is a curated fixed input, not an automatic parser of all addenda or a signed trust anchor. The raw HTML hash is provider-reported, not locally recomputed.

Example from this directory:
```sh
node compare-kofia-date.mjs kofia-date-boundaries-1820.json kofia-1820-page1.json kofia-1820-page2.json HY-SUNSET first_securities_registration 20281231
```

A DATE_MATCH result concerns the stated date wording only; fund eligibility, currentness, later amendments, substantive conditions, actual events and legal effect remain unverified. In particular, Annex 1 application clauses include more-favorable treatment for earlier misconduct; the annex contents and actual conduct date are necessary before any sanction calculation. Attachment access remains blocked; request the official original HWP files (Annex 1 and 1-2 first) and the FSS full preparation standard/forms PDF from the user. No production code, deployment or authentication change. The prior 1853 runtime regression tests were not rerun.
