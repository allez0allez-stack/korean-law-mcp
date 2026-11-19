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
  out+="\n※ 현행 3단비교를 재사용하지 않고 기준일에 따라 세 버전을 별도 선택했습니다.\n"
  out+="※ 본문 직접 인용과 문언 대응 후보는 위임 적법성·내용의 범위 일치·부칙 경과규정의 적용을 증명하지 않습니다.\n"
  out+="※ 해당 기준일 이전에 공포되어 나중에 시행되는 개정의 영향과 분리시행 여부는 추가 검토가 필요합니다.\n"
  out+="※ 원문: get_law_text(mst="+law.version.mst+", efYd="+law.version.efYd+", jo="+jo+"); get_law_text(mst="+decree.version.mst+", efYd="+decree.version.efYd+", jo="+decreeJo+"); execute_tool(tool_name='get_admin_rule',params={id:"+notice.version.serial+",jo:"+selectedNoticeJo+"})\n"
  return {content:[{type:"text",text:truncateResponse(out)}]}
}
