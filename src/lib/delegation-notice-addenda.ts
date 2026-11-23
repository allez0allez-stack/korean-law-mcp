/**
 * Conservative administrative-rule addenda audit.
 * Uses the original per-serial XML parse (AdminRuleDoc.addenda), not truncated
 * text from get_admin_rule, and never decides substantive legal applicability.
 */
export type NoticeAddendumSignal = "notice_article" | "decree_article" | "transition_phrase"
export interface NoticeAddendumExcerpt {
  block: number
  signal: NoticeAddendumSignal
  excerpt: string
}
export interface NoticeAddendumReview {
  status: "evidence_found" | "no_direct_match" | "not_verified"
  blocks: number
  scannedLines: number
  noticeMentions: number
  decreeMentions: number
  transitionLines: number
  excerpts: NoticeAddendumExcerpt[]
  omitted: number
}

const TRANSITION = /경과조치|적용례|특례|시행\s*당시|시행\s*전에?|시행\s*이후|종전의\s*규정|유예|시행일|시행\s*한다|시행\s*함|부터\s*시행|공포\s*후\s*\d+\s*(?:개월|년|일)/
function noticeArticlePattern(article: string): RegExp | null {
  // Administrative provisions include a dash branch: 제7-41조의7.
  const m = article.replace(/\s+/g, "").match(/^제(\d+)(?:-(\d+))?조(?:의(\d+))?$/)
  if (!m) return null
  const main = Number(m[1])
  const dash = m[2] === undefined ? "(?!\\s*-\\s*\\d)" : "\\s*-\\s*" + Number(m[2])
  const branch = m[3] === undefined ? "(?!\\s*의\\s*\\d)" : "\\s*의\\s*" + Number(m[3])
  return new RegExp("제\\s*" + main + dash + "\\s*조" + branch + "(?!\\d)")
}
function compactEvidence(line:string, target:RegExp | null): string {
  const at = target ? line.search(target) : -1
  const from = Math.max(0, at < 0 ? 0 : at - 65)
  const slice = line.slice(from, from + 275).replace(/\s+/g," ").trim()
  return (from ? "…" : "") + slice + (from + 275 < line.length ? "…" : "")
}

/**
 * The presence of an addendum is evidence of its text, not proof that a
 * transitional rule is applicable to a specific investment/transaction.
 */
export function reviewNoticeAddenda(
  addenda: string[] | null,
  noticeArticle: string,
  decreeArticle: string,
  maxExcerpts = 5,
): NoticeAddendumReview {
  const noEvidence: NoticeAddendumReview = {
    status:"not_verified", blocks:0, scannedLines:0, noticeMentions:0,
    decreeMentions:0, transitionLines:0, excerpts:[], omitted:0,
  }
  if (addenda === null || !Array.isArray(addenda) || addenda.length === 0) return noEvidence
  const noticeRe = noticeArticlePattern(noticeArticle)
  const decreeRe = noticeArticlePattern(decreeArticle)
  if (!noticeRe || !decreeRe) return noEvidence
  type Candidate= NoticeAddendumExcerpt & { rank:number }
  const candidates:Candidate[]=[]
  let scannedLines=0, noticeMentions=0, decreeMentions=0, transitionLines=0
  let hasText=false
  // Separate block IDs exactly as extracted by the official rule XML.
  // Each <부칙내용> can contain several paragraphs; do not assume one line.
  for (let index=0; index<addenda.length; index++) {
    const raw=addenda[index]
    if (typeof raw!=="string" || !raw.trim()) continue
    hasText=true
    const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
    for(const line of lines) {
      scannedLines++
      const notice=noticeRe.test(line), decree=decreeRe.test(line)
      const transition=TRANSITION.test(line)
      if(notice) noticeMentions++
      if(decree) decreeMentions++
      if(transition) transitionLines++
      if(!notice && !decree && !transition) continue
      const signal:NoticeAddendumSignal=notice ? "notice_article" :
        decree ? "decree_article" : "transition_phrase"
      candidates.push({
        block:index+1, signal, rank:notice?3:decree?2:1,
        excerpt:compactEvidence(line,notice?noticeRe:decree?decreeRe:null),
      })
    }
  }
  if (!hasText) return noEvidence
  candidates.sort((a,b)=>b.rank-a.rank || a.block-b.block)
  const size=Math.max(1,Math.min(maxExcerpts,8))
  return {
    status:candidates.length?"evidence_found":"no_direct_match",
    blocks:addenda.length,scannedLines,noticeMentions,decreeMentions,transitionLines,
    excerpts:candidates.slice(0,size).map(({block,signal,excerpt})=>({block,signal,excerpt})),
    omitted:Math.max(0,candidates.length-size),
  }
}

/** Risk hints from *the same rule genealogy*, never assume an effective provision. */
export function findNoticeFutureIssueRisks(
  group:Array<{serial:string;issuedYd:string;efYd:string;issuedNo:string}>,
  selected:{serial:string;issuedYd:string;efYd:string},
  asOf:string,
  limit=3,
):string[] {
  const candidates=group.filter(v=>v.serial!==selected.serial && v.issuedYd &&
    v.issuedYd<=asOf && v.efYd && v.efYd>asOf)
  candidates.sort((a,b)=>a.efYd.localeCompare(b.efYd) || a.issuedYd.localeCompare(b.issuedYd))
  return candidates.slice(0,Math.max(0,limit)).map(v=>
    "발령 제"+v.issuedNo+"호("+v.issuedYd+")의 시행일 "+v.efYd+
    "이 기준일 "+asOf+"보다 늦습니다. 해당 규정 조문에 영향 여부 확인 필요"
  )
}
