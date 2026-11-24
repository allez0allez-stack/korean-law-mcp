/** Fail closed when the official revision index cannot uniquely identify a version. */
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

function validDate(y: string, m: string, d: string): string | null {
  const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  const parsed = new Date(date + "T00:00:00Z")
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}

export function parseKofiaLatestIpoVersion(indexHtml: string): KofiaResolvedVersion | null {
  const rows = [...indexHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(m => m[0])
  const candidates: KofiaResolvedVersion[] = []
  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/gi)].map(m => m[0])
    const titles = cells.filter(cell => visibleRow(cell) === KOFIA_IPO_RULE_NAME)
    if (!titles.length) {
      // A changed markup around the exact title must not silently hide a newer version.
      const titleLinks = [...row.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)]
      if (titleLinks.some(link => visibleRow(link[0]) === KOFIA_IPO_RULE_NAME)) return null
      continue
    }
    if (titles.length !== 1) return null
    const dates = cells.map(visibleRow).map(cell => /^(20\d{2})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/.exec(cell)).filter(m => m !== null)
    if (dates.length !== 1) return null
    const amendedOn = validDate(dates[0][1], dates[0][2], dates[0][3])
    if (!amendedOn) return null
    const normalized = titles[0].replace(/&amp;/gi, "&").replace(/&#39;/gi, "'")
    const ids = new Set<string>()
    for (const m of normalized.matchAll(/historySeq\s*(?:=|%3D|:\s*["']?|["']\s*,\s*["'])(\d{3,8})(?!\d)/gi)) ids.add(m[1])
    for (const m of normalized.matchAll(/(?:revisionView|fnRevision|goRevision|openRevision|fnViewRevision)\w*\s*\(\s*["']?(\d{3,8})\b/gi)) ids.add(m[1])
    // A missing or ambiguous link is an unresolved candidate, not an older-version fallback.
    if (ids.size !== 1) return null
    const historySeq = [...ids][0]
    candidates.push({ historySeq, amendedOn,
      url: "https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq=" + historySeq + "&seq=" + KOFIA_IPO_RULE_SEQ,
      indexUrl: KOFIA_REVISION_INDEX_URL })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.amendedOn.localeCompare(a.amendedOn))
  const newest = candidates[0]
  // Same-date different revisions cannot be ordered by assuming historySeq is chronological.
  if (candidates.some(c => c.amendedOn === newest.amendedOn && c.historySeq !== newest.historySeq)) return null
  if (candidates.some(c => c.historySeq === newest.historySeq && c.amendedOn !== newest.amendedOn)) return null
  return newest
}

export function latestRevisionDateInRule(htmlText: string): string | null {
  const normalized = htmlText.replace(/\s+/g, " ")
  const chapterStart = normalized.search(/제\s*1\s*장\s*총칙/)
  const preamble = normalized.slice(0, chapterStart > -1 ? chapterStart : 7500)
  const dates: string[] = []
  for (const m of preamble.matchAll(/개정\s*(20\d{2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})/g)) {
    const date = validDate(m[1], m[2], m[3])
    if (!date) return null
    dates.push(date)
  }
  return dates.sort().at(-1) ?? null
}
