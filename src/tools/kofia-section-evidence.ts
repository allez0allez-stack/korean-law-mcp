/** Bounded article and supplementary-provision extraction from visible KOFIA text.
 * Heading candidates are never a substitute for a verified DOM/official source.
 */
export interface KofiaSectionEvidence {
  article: string
  excerpt: string
  status: "HEADING_BOUNDED" | "EXCERPT_ONLY" | "AMBIGUOUS" | "NOT_FOUND"
  truncated: boolean
}
const articlePattern = /제[ \t]*\d+[ \t]*조(?:[ \t]*의[ \t]*\d+)?[ \t]*\([^\n()]{1,160}\)/g
const normalize = (s: string) => s.replace(/\s+/g, "").split("(")[0]
const tidy = (s: string) => s.replace(/\s+/g, " ").trim()
function bounded(text: string, cap: number) {
  const clean = tidy(text)
  return { excerpt: clean.slice(0, cap), truncated: clean.length > cap }
}
export function extractRuleSections(text: string, articles: readonly string[], cap = 680): KofiaSectionEvidence[] {
  const headings = [...text.matchAll(articlePattern)].map(m => ({
    id: normalize(m[0]), start: m.index!, end: m.index! + m[0].length,
    lineStart: !text.slice(text.lastIndexOf("\n", m.index! - 1) + 1, m.index).trim(),
  }))
  const appendix = [...text.matchAll(/(?:^|\n)[ \t]*부[ \t]*칙(?=[ \t(\n]|$)/g)].map(m => m.index!)
  const strong = headings.filter(h => h.lineStart)
  return articles.map(article => {
    const candidates = strong.filter(h => h.id === article)
    const fallback = headings.filter(h => h.id === article)
    if (candidates.length > 1 || (!candidates.length && fallback.length > 1)) {
      return { article, excerpt: "", status: "AMBIGUOUS", truncated: false }
    }
    const h = candidates[0] ?? fallback[0]
    if (!h) return { article, excerpt: "", status: "NOT_FOUND", truncated: false }
    const next = (h.lineStart ? strong : headings).find(n => n.start > h.start)
    const end = Math.min(next?.start ?? text.length, ...appendix.filter(i => i > h.start), text.length)
    // Without a subsequent structural boundary, do not attest article completeness.
    const proven = h.lineStart && end < text.length
    const snippet = bounded(text.slice(h.start, end), cap)
    return { article, ...snippet, status: proven ? "HEADING_BOUNDED" : "EXCERPT_ONLY" }
  })
}
export function extractSupplementarySection(text: string, amendedOn: string, cap = 900): KofiaSectionEvidence {
  const headings = [...text.matchAll(/(?:^|\n)[ \t]*부[ \t]*칙[ \t]*\([ \t]*(20\d{2})[.\/-][ \t]*(\d{1,2})[.\/-][ \t]*(\d{1,2})\.?[ \t]*\)/g)]
  const matches = headings.filter(m => `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}` === amendedOn)
  const article = `부칙 (${amendedOn})`
  if (matches.length !== 1) return { article, excerpt: "", truncated: false, status: matches.length ? "AMBIGUOUS" : "NOT_FOUND" }
  const start = matches[0].index!
  const end = Math.min(headings.find(m => m.index! > start)?.index ?? text.length, text.indexOf("[별표/서식 파일]", start) < 0 ? text.length : text.indexOf("[별표/서식 파일]", start))
  return { article, ...bounded(text.slice(start,end),cap), status: end < text.length ? "HEADING_BOUNDED" : "EXCERPT_ONLY" }
}
