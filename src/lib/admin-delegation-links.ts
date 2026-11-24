/** Parse the authenticated lsDelegated envelope observed in live labor/finance probes. */
export interface AdminLinkSource { lawName: string; mst: string; lawId?: string; effectiveDate: string }
export interface AdminDelegationLink { serial: string; name: string; sourceArticle: string; wording: string; location: string }
export interface AdminLinkResult { status: "NOT_VERIFIED" | "PARTIAL" | "LINKS_FOUND" | "NO_LINK_IN_RESPONSE"; links: AdminDelegationLink[]; reason: string }
const object = (v: unknown): Record<string,unknown> | undefined => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string,unknown> : undefined
const rows = (v: unknown): unknown[] => Array.isArray(v) ? v : v == null ? [] : [v]
const scalar = (v: unknown): string => typeof v === "string" ? v.trim() : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : ""
const nameKey = (v: unknown) => scalar(v).replace(/[\s·ㆍ‧•・]/g, "")
const idKey = (v: unknown) => scalar(v).replace(/^0+(?=\d)/, "")
function joKey(v: unknown, branch?: unknown): string {
  const s = scalar(v).replace(/\s+/g, ""), b = scalar(branch)
  const explicit = /^제(\d{1,4})조(?:의(\d{1,2}))?$/.exec(s)
  if (explicit && Number(explicit[1]) > 0 && (!explicit[2] || Number(explicit[2]) > 0)) {
    if (b && (!/^\d{1,2}$/.test(b) || Number(b) !== Number(explicit[2] || 0))) return ""
    return explicit[1].padStart(4,"0")+(explicit[2]||"0").padStart(2,"0")
  }
  if (/^\d{6}$/.test(s) && Number(s.slice(0,4))>0) return !b || (/^\d{1,2}$/.test(b)&&Number(b)===Number(s.slice(4))) ? s : ""
  if (/^\d{1,4}$/.test(s)&&Number(s)>0&&(!b||/^\d{1,2}$/.test(b))) return s.padStart(4,"0")+(b||"0").padStart(2,"0")
  return ""
}
export function parseDelegatedAdminLinks(payload: unknown, source: AdminLinkSource, article: string): AdminLinkResult {
  const fail = (reason: string): AdminLinkResult => ({status:"NOT_VERIFIED",links:[],reason})
  const want = joKey(article)
  const envelope = object(object(object(payload)?.lsDelegated)?.법령)
  const meta = object(envelope?.법령정보)
  if (!want || !meta || !source.lawName || !/^\d+$/.test(source.mst) || !/^\d{8}$/.test(source.effectiveDate)) return fail("공식 응답 또는 시작 식별정보 미확인")
  if (nameKey(meta.법령명)!==nameKey(source.lawName) || idKey(meta.법령일련번호)!==idKey(source.mst) || scalar(meta.시행일자)!==source.effectiveDate || (source.lawId && idKey(meta.법령ID)!==idKey(source.lawId))) return fail("시작 법령·ID·MST·시행일 불일치")
  const articles = rows(envelope?.위임조문정보)
  if (articles.length > 5000) return fail("조문 목록 크기 한도 초과")
  const links = new Map<string,AdminDelegationLink>(), names = new Map<string,string>()
  let matched = false, partial = false, visited = 0
  for (const item of articles) {
    const row = object(item), jo = object(row?.조정보)
    if (!jo || !joKey(jo.조문번호,jo.조문가지번호)) {partial=true;continue}
    if (joKey(jo.조문번호,jo.조문가지번호)!==want) continue
    matched=true
    for (const item of rows(row?.위임정보)) {
      const delegation=object(item)
      if (!delegation) {partial=true;continue}
      // Official child field identifies administrative-rule links; the parent's
      // numeric/text classification is not inferred as a legal conclusion.
      if (!Object.hasOwn(delegation,"위임행정규칙조문정보")) continue
      if (Object.hasOwn(delegation,"위임법령조문정보") || Object.hasOwn(delegation,"위임규정조문정보")) {partial=true;continue}
      const entries=rows(delegation.위임행정규칙조문정보)
      if (!entries.length) partial=true
      for (const item of entries) {
        if (++visited>5000) return fail("위임 목록 크기 한도 초과")
        const link=object(item), serial=scalar(link?.위임행정규칙일련번호), name=scalar(link?.위임행정규칙제목), location=scalar(link?.조항호목)
        const loc=location.match(/^제\s*\d+\s*조(?:\s*의\s*\d+)?/)
        if (!/^\d{13}$/.test(serial)||!name||name.length>200||(loc&&joKey(loc[0])!==want)) {partial=true;continue}
        if (names.has(serial)&&names.get(serial)!==nameKey(name)) return fail("같은 행정규칙 일련번호의 제목 충돌")
        names.set(serial,nameKey(name))
        const wording=scalar(link?.라인텍스트).slice(0,500)
        links.set(JSON.stringify([serial,location,wording]),{serial,name,sourceArticle:article,wording,location:location.slice(0,100)})
      }
    }
  }
  if (!matched) return fail("공식 목록에서 정확한 시작 조문 미확인")
  const found=[...links.values()].sort((a,b)=>a.serial.localeCompare(b.serial))
  return {status:partial?"PARTIAL":found.length?"LINKS_FOUND":"NO_LINK_IN_RESPONSE",links:found,reason:partial?"일부 연결 행 식별 실패":found.length?"공식 위임행정규칙조문정보 등재 확인(원문·효력 별도 검증)":"해당 응답 범위에서 연결 미확인(부존재 단정 금지)"}
}
