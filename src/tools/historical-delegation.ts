/**
 * Historical delegation cross-check. NEVER use the current three-tier endpoint as a
 * substitute for an as-of snapshot. All three versions are selected independently.
 * Only direct text citations/wording candidates are graded, not legal validity.
 */
import type { LawApiClient } from "../lib/api-client.js"
import { fetchLineageVersions, lawStateAt, todayKst } from "../lib/law-lineage.js"
import { fetchAdminRuleHistory, pickAdminRuleGroup, adminVersionAt } from "../lib/admin-rule-history.js"
import { getLawText } from "./law-text.js"
import { getAdminRule } from "./admin-rule.js"
import { classifyNoticeScope } from "../lib/delegation-scope.js"
import { truncateResponse } from "../lib/schemas.js"
import { reviewHistoricalAddenda, findHistoricalStagingRisks } from "../lib/delegation-addenda.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"

export interface HistoricalDelegationInput {
  lawId: string
  jo: string
  decreeLawId: string
  decreeJo: string
  adminRuleName: string
  adminRuleId: string
  asOf: string
  apiKey?: string
}

const report = (message: string) => ({
  content: [{ type: "text", text: "[NOT_VERIFIED] " + message }],
})

const errorText = (response: {content:Array<{text:string}>,isError?:boolean}): string | undefined => {
  const t = response.content[0]?.text || ""
  return response.isError || !t || t.includes("[NOT_FOUND]") || t.includes("[응답 크기 제한]")
    ? t.slice(0, 160) || "원문 없음" : undefined
}

export async function verifyHistoricalDelegation(
  apiClient: LawApiClient,
  input: HistoricalDelegationInput,
): Promise<{content: Array<{type:string,text:string}>,isError?:boolean}> {
  const {lawId,jo,decreeLawId,decreeJo,adminRuleName,adminRuleId,asOf,apiKey}=input
  if (asOf > todayKst()) return report("미래 기준일은 확정 시행본을 재구성할 수 없습니다.")
  if (lawId.replace(/^0+/,"") === decreeLawId.replace(/^0+/,"")) {
    return report("법률 및 시행령 법령ID가 동일합니다. 서로 다른 정확한 법령ID가 필요합니다.")
  }

  // Fail closed on incomplete lineages; no current-three-tier fetch on this path.
  const [lawHistory, decreeHistory, noticeHistory] = await Promise.all([
    fetchLineageVersions(apiClient,lawId,apiKey),
    fetchLineageVersions(apiClient,decreeLawId,apiKey),
    fetchAdminRuleHistory(apiClient,adminRuleName,apiKey),
  ])
  if (!lawHistory.versions.length || !decreeHistory.versions.length) {
    return report("법률 또는 시행령 계보가 불완전합니다. 버전을 추정하지 않습니다.")
  }
  if (noticeHistory.truncated) return report("행정규칙 연혁 검색이 페이지 상한에 걸렸습니다. 기준일 버전을 확정하지 않습니다.")
  const noticeGroup = pickAdminRuleGroup(noticeHistory.groups, adminRuleName)
  if (!noticeGroup || !noticeGroup.some(v=>v.serial===adminRuleId)) {
    return report("지정한 행정규칙의 이름과 일련번호가 같은 연혁 계보로 확인되지 않았습니다.")
  }
  const law = lawStateAt(lawHistory.versions,asOf)
  const decree = lawStateAt(decreeHistory.versions,asOf)
  const notice = adminVersionAt(noticeGroup,asOf)
  if (!law.version || !decree.version || !notice.version) {
    return report("기준일에 법률·시행령·고시 중 하나의 시행 버전을 확정하지 못했거나 폐지됐습니다.")
  }
  if (notice.note) return report("분리시행 위험: " + notice.note + " 정확한 조문 적용이 불확실하여 보류합니다.")
  // Explicit exact identifier path. Historical mapping itself is not inferred
  // from modern three-tier links (which could have changed since the date).
  const [lawTextR,decreeTextR,noticeTextR] = await Promise.all([
    getLawText(apiClient,{mst:law.version.mst,efYd:law.version.efYd,jo,apiKey}),
    getLawText(apiClient,{mst:decree.version.mst,efYd:decree.version.efYd,jo:decreeJo,apiKey}),
    getAdminRule(apiClient,{id:notice.version.serial,keyword:decreeJo,max_results:5,apiKey}),
  ])
  const failed = [
    ["법률",errorText(lawTextR)],
    ["시행령",errorText(decreeTextR)],
    ["고시",errorText(noticeTextR)],
  ].filter((v)=>v[1])
  if (failed.length) return report("선택된 연혁 원문 조회 실패: " + failed.map(x=>x.join(" ")).join("; "))
  const lawText=lawTextR.content[0].text
  const decreeText=decreeTextR.content[0].text
  const noticeSearchText=noticeTextR.content[0].text
  // A keyword response may truncate long notice articles, silently omitting later
  // clauses. Only one exact article is safe to resolve automatically.
  const hit=noticeSearchText.match(/'[^']+' 포함 조문 (\d+)개: ([^\n]+)/)
  if (!hit || Number(hit[1]) !== 1) {
    return report("고시 검색 결과가 단일 조문으로 특정되지 않습니다. 해당 고시의 정확한 조문을 별도 조회해야 합니다.")
  }
  const selectedNoticeJo=hit[2].trim()
  const noticeFullR=await getAdminRule(apiClient,{id:notice.version.serial,jo:selectedNoticeJo,apiKey})
  const noticeFailure=errorText(noticeFullR)
  if (noticeFailure) return report("고시의 선택 조문 원문을 온전히 확보하지 못했습니다: "+noticeFailure)
  const noticeText=noticeFullR.content[0].text
  const requiredLawDate = "시행일: " + law.version.efYd
  const requiredDecreeDate = "시행일: " + decree.version.efYd
  const requiredNoticeDate = "시행일: " + notice.version.efYd.slice(0,4)+"."+notice.version.efYd.slice(4,6)+"."+notice.version.efYd.slice(6)
  if (!lawText.includes(requiredLawDate) || !decreeText.includes(requiredDecreeDate) || !noticeText.includes(requiredNoticeDate)) {
    return report("연혁에서 선택한 시행일과 반환된 법령·고시 원문의 시행일이 일치하지 않습니다.")
  }
  if (!lawText.includes(jo) || !decreeText.includes(decreeJo)) {
    return report("선택된 버전에서 요구한 법률 또는 시행령 조문을 확인하지 못했습니다.")
  }

  // Full JSON is required: get_law_text(jo="부칙") textual output truncates
  // after 50k chars for large financial statutes and can hide relevant clauses.
  const stages=[
    ...findHistoricalStagingRisks(lawHistory.versions,law.version,asOf).map(x=>"[법률] "+x.detail),
    ...findHistoricalStagingRisks(decreeHistory.versions,decree.version,asOf).map(x=>"[시행령] "+x.detail),
  ]
  const addendaRequests=[
    {label:"법률",version:law.version,article:jo},
    {label:"시행령",version:decree.version,article:decreeJo},
  ]
  const rawResults=await Promise.allSettled(addendaRequests.map(x=>
    apiClient.getLawText({mst:x.version.mst,efYd:x.version.efYd,apiKey})
  ))
  const addendaLines:string[]=[]
  for(let i=0;i<rawResults.length;i++) {
    const req=addendaRequests[i]
    const raw=rawResults[i]
    if(raw.status==="rejected") {
      rethrowIfFatal(raw.reason)
      addendaLines.push("["+req.label+"][NOT_VERIFIED] 기준시점 원본 부칙 JSON 조회 실패")
      continue
    }
    try {
      const obj=JSON.parse(raw.value)
      const sourceDate=String(obj?.법령?.기본정보?.시행일자||"")
      if(sourceDate!==req.version.efYd) {
        addendaLines.push("["+req.label+"][NOT_VERIFIED] 선택한 시행일과 원본 부칙의 시행일 불일치")
        continue
      }
      const info=reviewHistoricalAddenda(obj,req.article,req.version.ancNo)
      if(info.status==="not_verified") {
        addendaLines.push("["+req.label+"][NOT_VERIFIED] 부칙 원자료 구조 누락")
        continue
      }
      addendaLines.push("["+req.label+"] 부칙 "+info.totalUnits+"건 중 "+req.article+" 직접 언급 "+info.articleMentions+"개 라인; 검토 근거 "+info.excerpts.length+"건"+(info.omitted?" (추가 "+info.omitted+"건 미표시)":""))
      for(const ex of info.excerpts) {
        const tag=ex.signal==="article_reference"?"조문 직접 언급":ex.signal==="selected_promulgation"?"선택 공포본 부칙":"기타"
        addendaLines.push("  [적용 여부 미확정:"+tag+"] "+ex.heading+": "+ex.excerpt)
      }
      if(info.articleMentions===0) addendaLines.push("  ※ 직접 조문번호 미발견은 관련 부칙 없음 또는 적용되지 않음이라는 뜻이 아닙니다.")
    } catch(error) {
      rethrowIfFatal(error)
      addendaLines.push("["+req.label+"][NOT_VERIFIED] 원본 부칙 파싱 또는 확인 실패")
    }
  }
  const addendaUnverified=addendaLines.some(line=>line.includes("[NOT_VERIFIED]"))

  const matches=classifyNoticeScope(decreeJo,decreeText,noticeText)
  const base=jo.replace(/\s+/g,"").match(/^제(\d+)조(?:의(\d+))?$/)
  if (!base) return report("법률 조문번호 형식이 잘못됐습니다.")
  const lawCitation=new RegExp("법\\s*제\\s*"+Number(base[1])+"\\s*조"+(base[2]?"\\s*의\\s*"+Number(base[2]):"(?!\\s*의\\s*\\d)")+"(?!\\d)")
  const direct=lawCitation.test(decreeText)
  const counts={
    candidate:matches.filter(v=>v.status==="wording_candidate").length,
    review:matches.filter(v=>v.status==="review_required").length,
    unknown:matches.filter(v=>v.status==="not_verified").length,
  }
  let out="═══ 과거 기준일 3계층 독립 원문 대조: "+asOf+" ═══\n\n"
  out+="법률 "+jo+": LID "+lawId+", MST "+law.version.mst+", 시행 "+law.version.efYd+"\n"
  out+="시행령 "+decreeJo+": LID "+decreeLawId+", MST "+decree.version.mst+", 시행 "+decree.version.efYd+"\n"
  out+="고시 "+notice.version.name+": 행정규칙ID "+notice.version.ruleId+", 일련번호 "+notice.version.serial+", 시행 "+notice.version.efYd+"\n"
  out+="법률→시행령 직접 인용: "+(direct?"[본문 인용 확인]":"[직접 인용 미확인]")+"\n"
  out+="시행령→고시 직접 인용: "+matches.length+"건 (문언상 대응 후보 "+counts.candidate+", 추가 검토 "+counts.review+", 근거 미확인 "+counts.unknown+")\n"
  for (const item of matches) {
    const label=item.status==="wording_candidate"?"문언상 대응 후보":item.status==="review_required"?"추가 검토 필요":"근거 미확인"
    out+="["+label+"] "+item.cite+" — "+item.rationale+"\n"
  }
  out+="\\n▶ 부칙·분리시행 검토 게이트\\n"
  out+="시점적용 판단: "+(addendaUnverified?"[PARTIAL — 부칙 원자료 미확인]":"[REVIEW_REQUIRED — 원자료 확보, 적용 법리 판단 필요]")+"\\n"
  if(stages.length) {
    out+="분리시행·공포 후 시행예정 위험 "+stages.length+"건 (조항별 실제 시행시점 확인 필요)\\n"
    for(const item of stages.slice(0,5)) out+="[분리시행 검토] "+item+"\\n"
  } else {
    out+="연혁 계보상 동일 MST 다중 시행슬라이스·기준일 이전 공포 후 미시행 신호: 발견되지 않음 (부칙상 분리시행 부존재는 미확정)\\n"
  }
  for(const line of addendaLines) out+=line+"\\n"
  out+="※ 고시 부칙의 적용례·경과조치는 위 법률·시행령 부칙 검토에 포함되지 않으므로 별도 확인 필요.\\n"
  out+="\n※ 현행 3단비교를 재사용하지 않고 기준일에 따라 세 버전을 별도 선택했습니다.\n"
  out+="※ 본문 직접 인용과 문언 대응 후보는 위임 적법성·내용의 범위 일치·부칙 경과규정의 적용을 증명하지 않습니다.\n"
  out+="※ 해당 기준일 이전에 공포되어 나중에 시행되는 개정의 영향과 분리시행 여부는 추가 검토가 필요합니다.\n"
  out+="※ 원문: get_law_text(mst="+law.version.mst+", efYd="+law.version.efYd+", jo="+jo+"); get_law_text(mst="+decree.version.mst+", efYd="+decree.version.efYd+", jo="+decreeJo+"); execute_tool(tool_name='get_admin_rule',params={id:"+notice.version.serial+",jo:"+selectedNoticeJo+"})\n"
  return {content:[{type:"text",text:truncateResponse(out)}]}
}
