/**
 * Historical addenda evidence: select a bounded set of original provisions from
 * the exact effective-version JSON. This only flags possible application/transitions;
 * NEVER infer legal applicability from the existence or absence of a text match.
 */
import type {HistoricalVersion} from "./historical-utils.js"

type AddendumSignal = "article_reference" | "selected_promulgation" | "general_transition"
export interface AddendumEvidence {
  heading: string
  signal: AddendumSignal
  excerpt: string
}
export interface AddendaReview {
  status: "evidence_found" | "no_direct_match" | "not_verified"
  totalUnits: number
  articleMentions: number
  excerpts: AddendumEvidence[]
  omitted: number
}
const TRANSITION = /경과조치|적용례|특례|종전의\s*규정|시행\s*당시|시행\s*전|시행\s*이후|유예|시행일/
const PUNC = /\s+/g
function asUnits(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
}
function asLines(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(asLines)
  if (typeof v === "string") return v.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
  if (v === undefined || v === null) return []
  return typeof v === "object" ? [] : [String(v)]
}
function exactArticleRegex(article: string): RegExp | null {
  const m = article.replace(PUNC,"").match(/^제(\d+)조(?:의(\d+))?$/)
  if (!m) return null
  const tail = m[2] ? "\\s*의\\s*" + Number(m[2]) : "(?!\\s*의\\s*\\d)"
  return new RegExp("제\\s*" + Number(m[1]) + "\\s*조" + tail + "(?!\\d)")
}
function excerptAt(line:string, target:RegExp|null):string {
  const p=target ? line.search(target) : -1
  const from=p>=0 ? Math.max(0,p-65) : 0
  const slice=line.slice(from,from+260).replace(PUNC," ").trim()
  return (from>0?"…":"")+slice+(from+260<line.length?"…":"")
}
export function reviewHistoricalAddenda(
  json: unknown, requestedArticle: string, selectedAncNo: string, maxExcerpts = 5,
): AddendaReview {
  const root=(json as {법령?: {부칙?: {부칙단위?:unknown}}})?.법령
  const raw=root?.부칙?.부칙단위
  if (raw === undefined || raw === null) return {status:"not_verified",totalUnits:0,articleMentions:0,excerpts:[],omitted:0}
  const units=asUnits(raw)
  const re=exactArticleRegex(requestedArticle)
  if (!re) return {status:"not_verified",totalUnits:units.length,articleMentions:0,excerpts:[],omitted:0}
  const candidates:Array<AddendumEvidence & {rank:number}>= []
  let articleMentions=0
  for(const rawUnit of units) {
    if (typeof rawUnit!=="object" || !rawUnit) continue
    const unit=rawUnit as {부칙공포번호?:string|number,부칙공포일자?:string,부칙내용?:unknown}
    const lines=asLines(unit.부칙내용)
    if(!lines.length) continue
    const number=String(unit.부칙공포번호||"").replace(/^0+/,"")
    const selected=Boolean(selectedAncNo) && number===selectedAncNo.replace(/^0+/,"")
    const hit=lines.filter(line=>re.test(line))
    articleMentions+=hit.length
    const selectedLines=hit.length ? hit.slice(0,2) :
      selected ? lines.filter(line=>TRANSITION.test(line)).slice(0,2) : []
    const picked=selectedLines.length?selectedLines:(selected?lines.slice(0,1):[])
    if(!picked.length) continue
    const signal:AddendumSignal=hit.length?"article_reference":selected?"selected_promulgation":"general_transition"
    const rank=hit.length?3:selected?2:1
    const heading="부칙 제"+(number||"?")+"호"+(unit.부칙공포일자?" ("+unit.부칙공포일자+")":"")
    for(const line of picked) candidates.push({heading,signal,excerpt:excerptAt(line,hit.length?re:null),rank})
  }
  candidates.sort((a,b)=>b.rank-a.rank)
  const bounded=candidates.slice(0,Math.max(1,Math.min(8,maxExcerpts)))
  return {
    status:bounded.length?"evidence_found":"no_direct_match",
    totalUnits:units.length,articleMentions,
    excerpts:bounded.map(({heading,signal,excerpt})=>({heading,signal,excerpt})),
    omitted:Math.max(0,candidates.length-bounded.length),
  }
}
export interface StagedVersionRisk {
  kind: "same_mst_slices" | "published_future_change"
  detail: string
}
/** Risk signals only: same MST in multiple effective slices and already promulgated changes. */
export function findHistoricalStagingRisks(
  versions:HistoricalVersion[], selected:HistoricalVersion, asOf:string, max=3,
):StagedVersionRisk[] {
  const risks:StagedVersionRisk[]=[]
  const same=versions.filter(v=>v.mst===selected.mst && v.efYd!==selected.efYd)
  if(same.length) risks.push({kind:"same_mst_slices",detail:"선택 MST "+selected.mst+"의 시행 슬라이스 "+[selected.efYd,...same.map(v=>v.efYd)].sort().join(", ")})
  const future=versions.filter(v=>v.efYd>asOf && v.ancYd && v.ancYd<=asOf)
  for(const v of future.slice(0,Math.max(0,max-risks.length))) {
    risks.push({kind:"published_future_change",detail:"기준일 이전 공포 후 미시행: MST "+v.mst+", 공포 "+v.ancYd+", 시행 "+v.efYd})
  }
  return risks.slice(0,max)
}
