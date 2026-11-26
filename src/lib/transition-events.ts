/** Bounded event/date wording comparison, never a determination of applicability. */
import { z } from "zod"
import type { AdminRuleDoc } from "./admin-rule-doc.js"
import { INLINE_IMAGE_MARK, markInlineImages } from "./image-only-body.js"
import { throwIfRequestCancelled } from "./session-state.js"

export const TransitionEventsSchema=z.array(z.object({
  phrase:z.string().trim().min(2).max(100).regex(/^[^\r\n]+$/).describe("부칙에 실제 나타나는 사건 문언(예: 인정 또는 재인정을 신청하는)"),
  date:z.string().regex(/^\d{8}$/).describe("사용자가 제공한 사건 기준일 YYYYMMDD"),
}).strict()).min(1).max(4)
type Event=z.infer<typeof TransitionEventsSchema>[number]
const compact=(s:string)=>s.replace(/\s+/g,"")
export function validTransitionDate(value:string):boolean {
  if(!/^\d{8}$/.test(value))return false
  const y=Number(value.slice(0,4)), m=Number(value.slice(4,6)), d=Number(value.slice(6,8))
  const date=new Date(Date.UTC(y,m-1,d))
  return y>=1900&&y<=9999&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d
}
export function validTransitionEvents(events:Event[]):boolean {
  return events.every(e=>validTransitionDate(e.date)&&compact(e.phrase).length>=2)&&new Set(events.map(e=>compact(e.phrase))).size===events.length
}
const dateRelation=(event:string,cutoff:string)=>event<cutoff?"BEFORE":event===cutoff?"EQUAL":"AFTER"
function dateWordMatches(event:string,cutoff:string,word:string):boolean {
  switch(word){
    case "이후": case "부터": return event>=cutoff
    case "이전": case "까지": return event<=cutoff
    case "전": return event<cutoff
    case "후": return event>cutoff
    default: return false
  }
}
// Inspect only a literal issuance-number/date header. Do not infer a historical block's effective date.
function matchesIssuance(raw:string,doc:AdminRuleDoc):boolean {
  const h=/^\s*부칙\s*<제\s*([\d-]+)\s*호\s*,\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./.exec(raw.slice(0,160))
  return !!h&&h[1]===doc.promNo.trim()&&h[2]+h[3].padStart(2,"0")+h[4].padStart(2,"0")===doc.issuedDate
}
export function traceTransitionEvents(doc:AdminRuleDoc,events:Event[],keyword?:string):string[] {
  const addenda=doc.addenda??[]
  const lines=["[ADMIN_TRANSITION_EVENT_COMPARISON] 지정 문서 "+doc.ruleSerial+" | 발령 "+doc.issuedDate+" | 시행 "+doc.efDate,
    "사용자 제공 사건 날짜(사실 미검증)와 부칙 원문 비교. DATE_WORDING_MATCH는 직접 이어지는 날짜 문언의 산술적 충족만 표시합니다. 사건 발생·조건 충족·경과조치·적용법령·효력 판정 아님. 다른 조건·예외·상대일은 별도 검토. 기준일 시행 버전은 legal_analysis(mode=applicable_law)로 별도 확인.",
    ...events.map(e=>"[EVENT_INPUT] "+JSON.stringify(e)+" | 문서 시행일 대비 "+dateRelation(e.date,doc.efDate))]
  const indexed=addenda.slice(0,500).map((raw,i)=>({raw,i,issuance:matchesIssuance(raw,doc)}))
  const issuance=indexed.filter(b=>b.issuance)
  // Prefer a unique exact issuance header over old addenda in long consolidated texts.
  const ordered=issuance.length===1?[issuance[0],...indexed.filter(b=>!b.issuance)]:indexed
  let scanned=0, remaining=300_000, candidates=0, limited=addenda.length>100, compared=0
  const evidence:string[]=[], found=new Set<number>(), paired=new Set<number>()
  for(const {raw,i} of ordered.slice(0,100)){
    throwIfRequestCancelled()
    if(raw.length>Math.min(100_000,remaining)){limited=true;continue}
    const body=markInlineImages(raw)
    if(body.length>Math.min(100_000,remaining)||body.includes(INLINE_IMAGE_MARK)){limited=true;continue}
    remaining-=body.length;scanned++
    const headings=[...body.matchAll(/^\s*(제\d{1,4}조(?:의\d{1,2})?)\s*\(([^)\n]{1,100})\)/gm)]
    if(!headings.length){limited=true;continue}
    const header=body.split("\n",1)[0].trim().slice(0,100)
    for(const [j,h] of headings.entries()){
      if(!/시행일|적용례|경과조치|특례|적용시기|적용시점/.test(h[2]))continue
      const clause=body.slice(h.index!,headings[j+1]?.index??body.length).trim()
      const operative=body.slice(h.index!+h[0].length,headings[j+1]?.index??body.length)
      if(keyword&&!compact(clause).includes(compact(keyword)))continue
      const matches=events.map((e,n)=>({e,n})).filter(({e})=>compact(operative).includes(compact(e.phrase)))
      if(!matches.length)continue
      candidates++
      if(evidence.length>=8){limited=true;continue}
      const result:string[]=[], localPairs=new Set<number>()
      for(const {n} of matches)found.add(n)
      let dates=0
      for(const line of operative.split("\n")){
        for(const m of line.matchAll(/(?<!\d)(\d{4})[ \t]*년[ \t]*(\d{1,2})[ \t]*월[ \t]*(\d{1,2})[ \t]*일[ \t]*(이후|이전|부터|까지|전|후)(?:에)?(?=[ \t]|$)[ \t]*/g)){
          const cutoff=m[1]+m[2].padStart(2,"0")+m[3].padStart(2,"0")
          if(!validTransitionDate(cutoff))continue
          if(++dates>10){limited=true;break}
          const tail=compact(line.slice(m.index!+m[0].length))
          const direct=matches.filter(({e})=>tail.startsWith(compact(e.phrase)))
          if(direct.length!==1){result.push("[DATE_EVENT_UNRESOLVED] "+cutoff+" "+m[4]+" | 직접 사건 문언 "+(direct.length>1?"복수 일치":"미일치"));continue}
          const {e,n}=direct[0];paired.add(n);localPairs.add(n);compared++
          result.push("[EVENT_DATE_RELATION] "+JSON.stringify(e)+" | 원문 날짜 "+cutoff+" "+m[4]+" | DATE_RELATION="+dateRelation(e.date,cutoff)+" | "+(dateWordMatches(e.date,cutoff,m[4])?"DATE_WORDING_MATCH":"DATE_WORDING_NOT_MATCH"))
        }
        if(dates>10)break
      }
      for(const {e,n} of matches)if(!localPairs.has(n))result.push("[EVENT_MENTION_ONLY] "+JSON.stringify(e)+" | 동일 조항에 문언 존재, 직접 날짜 조건 미확정")
      const excerpt=clause.length>1200?clause.slice(0,1200)+" … [발췌 제한]":clause
      if(clause.length>1200)limited=true
      evidence.push("부칙 #"+(i+1)+" | "+header+" | "+h[1]+"("+h[2]+")\n"+result.join("\n")+"\n원문(조건·예외 포함 여부 별도 검토):\n"+excerpt)
    }
  }
  lines.push("[EVENT_COMPARISON_SCOPE] 부칙 블록 "+scanned+"/"+addenda.length+" | 제목·사건 문언 후보 "+candidates+"건 / 표시 "+evidence.length+"건 | 직접 날짜 비교 "+compared+"건 | 발령번호·일자 일치 헤더 "+issuance.length+"개. 제목 없는 조항·상대일·역순 날짜 문형 미지원. 전체 법률 적용 여부 미판정.")
  for(const [n,e] of events.entries())if(!paired.has(n))lines.push("[EVENT_NOT_PAIRED] "+JSON.stringify(e)+" | "+(found.has(n)?"직접 날짜 연결 미확정":"표시 범위에서 사건 문언 미확인")+"; 조건 부존재 단정 금지")
  if(limited||doc.attachments.length||!evidence.length)lines.push("[PARTIAL] 부칙 검색·발췌 한도, 미확인 문형·첨부파일 또는 미발견 범위 존재. 첨부파일 "+doc.attachments.length+"건 미열람.")
  if(evidence.length)lines.push("[ADMIN_TRANSITION_EVENT_EVIDENCE]\n"+evidence.join("\n\n"))
  return lines
}
