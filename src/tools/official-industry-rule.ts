/**
 * Official industry self-regulatory rule evidence for law_system.
 *
 * KOFIA association rules are NOT statutes and are not indexed by
 * the Ministry of Government Legislation's lawSearch API. Use only the
 * known official source; provenance, version and read failures stay explicit.
 * Arbitrary user-supplied URLs are never accepted (SSRF defense).
 */
import type { LawApiClient } from "../lib/api-client.js"
import { requestContext, getRequestSignal, throwIfRequestCancelled } from "../lib/session-state.js"
import { formatToolError } from "../lib/errors.js"
import { truncateResponse } from "../lib/schemas.js"
import type { ToolResponse } from "../lib/types.js"
import { KOFIA_REVISION_INDEX_URL, parseKofiaLatestIpoVersion, latestRevisionDateInRule } from "./kofia-version-resolver.js"
import { extractRuleSections, extractSupplementarySection, type KofiaSectionEvidence } from "./kofia-section-evidence.js"

export const KOFIA_IPO_RULE_URL = "https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq=1820&seq=140"
const MAX_HTML_BYTES = 1_000_000
const RULE_ARTICLES = ["제5조의2", "제5조의3", "제5조의4", "제5조의5", "제5조의6", "제5조의7", "제9조의3"] as const

export function shouldReadKofiaIpoRule(query: string, resolvedLawName: string): boolean {
  return resolvedLawName === "자본시장과 금융투자업에 관한 법률"
    && /코너스톤|사전\s*청약|사전\s*수요\s*(?:예측|조사)|IPO|공모주\s*(?:배정|수요예측)|증권\s*인수업무/i.test(query)
}

function decodeHtml(input: string): string {
  return input.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#[0-9]+);/gi, entity => {
    const named: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" }
    const lower = entity.toLowerCase()
    if (lower in named) return named[lower]
    if (/^&#x/i.test(entity)) {
      const n = Number.parseInt(entity.slice(3, -1), 16)
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " "
    }
    if (/^&#/.test(entity)) {
      const n = Number.parseInt(entity.slice(2, -1), 10)
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " "
    }
    return " "
  })
}

export function htmlRuleText(html: string): string {
  return decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

// Preserve HTML block and table-cell boundaries for article-heading candidates.
// The same reader still produces the original normalized text for version checks.
export function structuredKofiaRuleText(html: string): string {
  return htmlRuleText(html.replace(/<\/(?:td|th|tr|p|div|h[1-6]|li)\s*>|<br\b[^>]*>/gi, "\n"))
}

export function extractKofiaArticleEvidence(html: string): KofiaSectionEvidence[] {
  return extractRuleSections(structuredKofiaRuleText(html), RULE_ARTICLES)
    .filter(x => x.excerpt.length > 0)
}

function renderSection(x: KofiaSectionEvidence): string {
  if (!x.excerpt) return `${x.article} [${x.status}] 원문 위치·본문 미확인`
  const label = x.status === "HEADING_BOUNDED" ? "제목 경계 기반" : "경계 미확정 발췌"
  return `${x.article} 원문 위치 확인 [${label}${x.truncated ? '; 길이 제한으로 일부 발췌' : ''}]: ${x.excerpt}`
}

/** Fixed allowlisted KOFIA URL; HTTP redirects are never followed. */
export async function fetchKofiaOfficialHtml(url: string = KOFIA_IPO_RULE_URL): Promise<string> {
  throwIfRequestCancelled()
  // Only the issuer revision index or a validated numeric revision of rule 140.
  // Never allow user-supplied URLs or automated cross-origin redirects.
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" || parsed.hostname !== "law.kofia.or.kr" ||
      parsed.username || parsed.password || parsed.port ||
      !(url === KOFIA_REVISION_INDEX_URL ||
        (parsed.pathname === "/service/law/lawFullScreenContent.do" &&
         parsed.searchParams.get("seq") === "140" &&
         /^\d{3,8}$/.test(parsed.searchParams.get("historySeq") || "") &&
         [...parsed.searchParams.keys()].sort().join(",") === "historySeq,seq"))) {
    throw Error("금투협 조회 URL 허용목록 불일치")
  }
  requestContext.getStore()?.budget?.consumeUpstreamRequest()
  const timeout = AbortSignal.timeout(12000)
  const signal = getRequestSignal()
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, {
    redirect: "manual",
    signal: combined,
    headers: { accept: "text/html; charset=utf-8" },
  })
  if (!response.ok) throw Error(`금투협 원문 HTTP ${response.status}; 리다이렉트 자동 추적 안 함`)
  const contentType = response.headers.get("content-type") || ""
  if (!/text\/html|text\/plain/i.test(contentType)) throw Error(`금투협 예상 밖 콘텐츠 형식: ${contentType.slice(0, 80)}`)
  const reader = response.body?.getReader()
  if (!reader) throw Error("금투협 원문 body 없음")
  const fragments: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      throwIfRequestCancelled()
      const { value, done } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_HTML_BYTES) throw Error(`금투협 원문 용량 제한 ${MAX_HTML_BYTES} bytes`)
      requestContext.getStore()?.budget?.consumeUpstreamBody(value.byteLength)
      requestContext.getStore()?.budget?.ensureResponseBodySize(received)
      fragments.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of fragments) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const declaredCharset = /charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(contentType)?.[1]
  const charset = declaredCharset && /^(utf-8|euc-kr|ks_c_5601-1987)$/i.test(declaredCharset) ? declaredCharset : "utf-8"
  return new TextDecoder(charset).decode(bytes)
}

export async function getKofiaIpoRuleEvidence(
  _client: LawApiClient,
  params: { query: string; lawName: string; loadHtml?: () => Promise<string>; loadIndexHtml?: () => Promise<string> },
): Promise<ToolResponse> {
  if (!shouldReadKofiaIpoRule(params.query, params.lawName)) {
    return { content: [{ type: "text", text: "[NOT_APPLICABLE] 금투협 IPO 규정 대상 질의가 아닙니다." }] }
  }
  try {
    const revisionIndex = await (params.loadIndexHtml ?? (() => fetchKofiaOfficialHtml(KOFIA_REVISION_INDEX_URL)))()
    const version = parseKofiaLatestIpoVersion(revisionIndex)
    if (!version) throw Error("[LATEST_UNVERIFIED] 최신 제·개정 목록에서 정확한 규정명 및 historySeq 식별 실패 (첫 페이지 범위 밖 또는 웹 구조 변경)")
    const html = await (params.loadHtml ?? (() => fetchKofiaOfficialHtml(version.url)))()
    const plain = htmlRuleText(html)
    const currentHeaderDate = latestRevisionDateInRule(plain)
    if (!currentHeaderDate || currentHeaderDate !== version.amendedOn) {
      throw Error("[LATEST_UNVERIFIED] 최신 개정 목록 " + version.amendedOn +
        "과 규정 본문 연혁 " + (currentHeaderDate || "미확인") + "이 일치하지 않습니다")
    }
    if (!plain.includes("증권 인수업무 등에 관한 규정")) throw Error("금투협 공식 규정명 일치 검증 실패")
    const structured = structuredKofiaRuleText(html)
    const clauses = extractRuleSections(structured, RULE_ARTICLES)
    if (!clauses.some(x => x.excerpt.length > 0)) throw Error("금투협 관련 조문 본문 추출 실패")
    const supplement = extractSupplementarySection(structured, version.amendedOn)
    const status = `${version.amendedOn} 개정 목록·본문 연혁 대조 PASS`
    const output = [
      "[OFFICIAL_SELF_REGULATION / LATEST_INDEX_VERIFIED] 금융투자협회 증권 인수업무 등에 관한 규정",
      "※ 협회 자율규정(법률·시행령 아님). 최신 제·개정 목록의 버전을 확인했지만 적용 기준일별 시행일·경과조치는 별도 검증 필요.",
      `개정 목록: ${version.indexUrl}`,
      `원문: ${version.url} | 버전 historySeq=${version.historySeq}`,
      `원문 확인: ${status} | HTML 원문 직접 열람`,
      "※ 개별 조문은 제목 경계 기반 또는 일부 발췌이며 항·호·목 전체 및 적용 여부를 보증하지 않습니다.",
      renderSection(supplement),
      ...clauses.map(renderSection),
      "※ 인용된 조문이 실제 사안에 적용되는지, 부칙 시행일·경과조치는 별도 심사해야 합니다.",
    ].join("\n")
    return { content: [{ type: "text", text: truncateResponse(output) }] }
  } catch (error) {
    return formatToolError(new Error(`[LATEST_UNVERIFIED] 금투협 규정 최신본 확인/원문 조회 미완료: ${error instanceof Error ? error.message : String(error)}. 공식 개정 목록: ${KOFIA_REVISION_INDEX_URL}`), "kofia_official_rule")
  }
}
