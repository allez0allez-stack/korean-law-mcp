/**
 * 법률→시행령→고시 조문별 위임 문언 대조.
 * 단순 문언 근거 분류이며 적법성·위임범위·시행일의 법률적 판단은 하지 않는다.
 */
export type NoticeScopeStatus = "wording_candidate" | "review_required" | "not_verified"
export interface NoticeScopeEvidence {
  cite: string
  paragraph: number | null
  status: NoticeScopeStatus
  rationale: string
  noticeExcerpt: string
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
const GAZETTE = /금융위원(?:회|장)(?:가|이)?\s*정하여\s*고시(?:하는|한다|할|하도록)/

function paragraphBody(decreeText: string, paragraph: number): string | null {
  if (paragraph < 1 || paragraph > 20) return null
  const normalized = decreeText.replace(/\s+/g, " ")
  const marker = /[①-⑳]|<\d{1,2}>/g
  const found = [...normalized.matchAll(marker)]
  const parseNumber = (value: string): number =>
    value.startsWith("<") ? Number(value.slice(1,-1)) : CIRCLED.indexOf(value)+1
  const at = found.findIndex(m => parseNumber(m[0]) === paragraph)
  if (at < 0) return null
  return normalized.slice(found[at].index, at+1 < found.length ? found[at+1].index : undefined)
}

export function classifyNoticeScope(
  decreeJo: string,
  decreeText: string,
  noticeText: string,
  maxMatches = 8,
): NoticeScopeEvidence[] {
  const source = decreeJo.replace(/\s+/g, "").match(/^제(\d+)조(?:의(\d+))?$/)
  if (!source || !noticeText) return []
  const article = Number(source[1])
  const branch = source[2] === undefined ? null : Number(source[2])
  const re = /(?:^|[^가-힣A-Za-z0-9])영\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?!\s*(?:의\s*\d|\d))(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?/g
  const result: NoticeScopeEvidence[] = []
  for (const m of noticeText.matchAll(re)) {
    const citedBranch = m[2] === undefined ? null : Number(m[2])
    if (Number(m[1]) !== article || citedBranch !== branch) continue
    const clause = m[3] === undefined ? null : Number(m[3])
    const ref = m[0].trim()
    const after = noticeText.slice(m.index + m[0].length, m.index + m[0].length + 105)
    // 다음 고시 항의 문구를 끌어와 앞 항의 직접 위임으로 오인하지 않는다.
    const sameNoticeParagraph = after.split(/[①-⑳]|<\d{1,2}>/)[0]
    const excerpt = noticeText.slice(Math.max(0,m.index-35), Math.min(noticeText.length,m.index+m[0].length+105)).replace(/\s+/g," ").trim()
    let status: NoticeScopeStatus = "not_verified"
    let rationale = "시행령의 항 번호가 특정되지 않아 동일 위임 문언의 대응 범위를 검증하지 못함"
    if (clause !== null) {
      const paragraph = paragraphBody(decreeText, clause)
      if (paragraph === null) {
        rationale = "참조된 시행령 항의 원문 경계를 확인할 수 없음"
      } else if (GAZETTE.test(paragraph) && GAZETTE.test(sameNoticeParagraph)) {
        status = "wording_candidate"
        rationale = "같은 시행령 항 인용과 양쪽의 금융위원회 고시 위임 표현이 문언상 대응"
      } else {
        status = "review_required"
        rationale = "시행령 항 인용은 확인됐지만 양쪽의 고시 위임 표현이 직접 대응한다고 확인되지 않음"
      }
    }
    result.push({ cite:ref, paragraph:clause, status, rationale, noticeExcerpt:excerpt })
    if (result.length >= maxMatches) break
  }
  return result
}
