/**
 * Resolve the KOFIA IPO self-regulatory rule from the issuer's official
 * newest-first revision index, not a hard-coded historical historySeq.
 * If the target is off the index page or its link is unparseable, fail closed.
 */
export const KOFIA_REVISION_INDEX_URL = "https://law.kofia.or.kr/service/revision/revisionlist.do"
export const KOFIA_IPO_RULE_NAME = "증권 인수업무 등에 관한 규정"
export const KOFIA_IPO_RULE_SEQ = "140"

export interface KofiaResolvedVersion {
  historySeq: string
  amendedOn: string
  url: string
  indexUrl: string
}

function visibleRow(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim()
}

export function parseKofiaLatestIpoVersion(indexHtml: string): KofiaResolvedVersion | null {
  const rows = [...indexHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(m => m[0])
  const candidates: KofiaResolvedVersion[] = []
  for (const row of rows) {
    const text = visibleRow(row)
    if (!text.includes(KOFIA_IPO_RULE_NAME) ||
        text.includes(KOFIA_IPO_RULE_NAME + " 시행세칙")) continue
    const m = /\b(20\d{2})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\b/.exec(text)
    if (!m) continue
    const amendedOn = m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0")
    const normalized = row.replace(/&amp;/gi, "&").replace(/&#39;/gi, "'")
    const explicit = /historySeq\s*(?:=|%3D|:\s*["']?|["']\s*,\s*["'])(\d{3,8})/i.exec(normalized)?.[1]
    const linked = /(?:revisionView|lawFullScreenContent)\.do\?[^"'<>]*?historySeq=(\d{3,8})/i.exec(normalized)?.[1]
    const handler = /(?:revisionView|fnRevision|goRevision|openRevision|fnViewRevision)\w*\s*\(\s*["']?(\d{3,8})\b/i.exec(normalized)?.[1]
    const historySeq = explicit || linked || handler
    if (!historySeq) continue
    candidates.push({
      historySeq, amendedOn,
      url: "https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq=" + historySeq + "&seq=" + KOFIA_IPO_RULE_SEQ,
      indexUrl: KOFIA_REVISION_INDEX_URL,
    })
  }
  candidates.sort((a, b) => b.amendedOn.localeCompare(a.amendedOn) ||
    Number(b.historySeq) - Number(a.historySeq))
  return candidates[0] ?? null
}

export function latestRevisionDateInRule(htmlText: string): string | null {
  const normalized = htmlText.replace(/\s+/g, " ")
  const chapterStart = normalized.search(/제\s*1\s*장\s*총칙/)
  const preamble = normalized.slice(0, chapterStart > -1 ? chapterStart : 7500)
  const dates = [...preamble.matchAll(/개정\s*(20\d{2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})/g)]
    .map(m => m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0"))
  return dates.sort().at(-1) ?? null
}
