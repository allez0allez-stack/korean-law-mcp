/** Conservative parser for the documented lsDelegated JSON fields. Unknown envelopes fail closed.
 * Fixture-based parser only; live upstream envelope not yet attested.
 */
export interface AdminLinkSource { lawName: string; mst: string; lawId?: string; effectiveDate: string }
export interface AdminDelegationLink { serial: string; name: string; sourceArticle: string; wording: string; location: string }
export interface AdminLinkResult { status: "NOT_VERIFIED" | "PARTIAL" | "LINKS_FOUND" | "NO_LINK_IN_RESPONSE"; links: AdminDelegationLink[]; reason: string }
export function parseDelegatedAdminLinks(payload: unknown, source: AdminLinkSource, article: string): AdminLinkResult {
  const fail = (reason: string): AdminLinkResult => ({status:"NOT_VERIFIED",links:[],reason});
  const scalar = (v: unknown) => typeof v==="string" ? v.trim() : typeof v==="number" && Number.isSafeInteger(v) ? String(v) : "";
  const nameKey = (v: unknown) => scalar(v).replace(/[\s·ㆍ‧•・]/g,"");
  const idKey = (v: unknown) => scalar(v).replace(/^0+(?=\d)/,"");
  const joKey = (v: unknown, branch: unknown) => {
    const s=scalar(v).replace(/\s+/g,"");
    const b=scalar(branch);
    const explicit=/^제(\d{1,4})조(?:의(\d{1,2}))?$/.exec(s);
    if(explicit && Number(explicit[1])>0 && (!explicit[2] || Number(explicit[2])>0)) {
      if(b && (!/^\d{1,2}$/.test(b) || Number(b)!==Number(explicit[2]||0))) return "";
      return explicit[1].padStart(4,"0")+(explicit[2]||"0").padStart(2,"0");
    }
    if(/^\d{6}$/.test(s) && Number(s.slice(0,4))>0) return !b || (/^\d{1,2}$/.test(b)&&Number(b)===Number(s.slice(4))) ? s : "";
    if(/^\d{1,4}$/.test(s)&&Number(s)>0&&/^\d{1,2}$/.test(b)) return s.padStart(4,"0")+b.padStart(2,"0");
    return "";
  };
  const want=joKey(article,undefined);
  if(!want||!source.lawName||!/^\d+$/.test(source.mst)||!/^\d{8}$/.test(source.effectiveDate)) return fail("시작 법령·MST·시행일·조문 식별자 미확인");
  // Establish one source envelope before interpreting any article or link.
  // An identity found in an unrelated sibling must never authenticate another tree.
  const pending: Array<{node: unknown; parent: unknown; depth: number}> = [{node:payload,parent:null,depth:0}];
  const owners = new Set<object>();
  let inspected=0;
  while(pending.length){
    const {node,parent,depth}=pending.pop()!;
    if(++inspected>50000||depth>24)return fail("응답 구조 안전 한도 초과");
    if(!node||typeof node!=="object")continue;
    if(Array.isArray(node)){for(const child of node)pending.push({node:child,parent:node,depth:depth+1});continue;}
    const row=Object.fromEntries(Object.entries(node));
    const name=scalar(row["법령명"]), mst=scalar(row["법령일련번호"]), date=scalar(row["시행일자"]);
    if(name&&mst&&date){
      if(nameKey(name)!==nameKey(source.lawName)||idKey(mst)!==idKey(source.mst)||date!==source.effectiveDate)return fail("공식 연결 목록의 시작 법령 또는 시행일 불일치");
      if(source.lawId&&scalar(row["법령ID"])&&idKey(row["법령ID"])!==idKey(source.lawId))return fail("시작 법령ID 불일치");
      // Self-contained metadata/rows or a metadata-only child of a single object.
      const ownsContent = Object.values(row).some(value=>value!==null&&typeof value==="object")||Object.prototype.hasOwnProperty.call(row,"조문번호");
      const owner = ownsContent||node===payload ? node : parent;
      if(!owner||typeof owner!=="object"||Array.isArray(owner))return fail("시작 법령 메타데이터의 응답 범위 미확인");
      owners.add(owner);
    }
    for(const child of Object.values(row))if(child&&typeof child==="object")pending.push({node:child,parent:node,depth:depth+1});
  }
  if(owners.size!==1)return fail("공식 응답의 단일 시작 법령 범위 미확인");
  const queue=[{node:[...owners][0] as unknown,scope:"",depth:0}];
  const links=new Map<string, AdminDelegationLink>();
  let identities=0,matchedArticle=false,malformed=false,visited=0;
  while(queue.length){
    const current=queue.pop();
    if(!current) break;
    const {node,depth}=current;
    if(++visited>50000||depth>24)return fail("응답 구조 안전 한도 초과");
    if(!node||typeof node!=="object")continue;
    if(Array.isArray(node)){for(const child of node)queue.push({node:child,scope:current.scope,depth:depth+1});continue;}
    const row=Object.fromEntries(Object.entries(node));
    const lawName=scalar(row["법령명"]), mst=scalar(row["법령일련번호"]), date=scalar(row["시행일자"]);
    if(lawName&&mst&&date){
      if(nameKey(lawName)!==nameKey(source.lawName)||idKey(mst)!==idKey(source.mst)||date!==source.effectiveDate)return fail("공식 연결 목록의 시작 법령 또는 시행일 불일치");
      if(source.lawId&&scalar(row["법령ID"])&&idKey(row["법령ID"])!==idKey(source.lawId))return fail("시작 법령ID 불일치");
      identities++;
    }
    const scope=Object.prototype.hasOwnProperty.call(row,"조문번호")?joKey(row["조문번호"],row["조문가지번호"]):current.scope;
    if(scope===want){
      matchedArticle=true;
      const serial=scalar(row["위임행정규칙일련번호"]), name=scalar(row["위임행정규칙제목"]), kind=scalar(row["위임구분"]).replace(/\s+/g,"");
      if(serial||name||kind==="위임행정규칙"){
        if(!/^\d{1,16}$/.test(serial)||!name||name.length>200||kind!=="위임행정규칙")malformed=true;
        else {
          const prior=links.get(serial);
          if(prior&&nameKey(prior.name)!==nameKey(name))return fail("같은 행정규칙 일련번호의 제목 충돌");
          links.set(serial,{serial,name,sourceArticle:article,wording:scalar(row["라인텍스트"]).slice(0,500),location:scalar(row["조항호목"]).slice(0,100)});
        }
      }
    }
    for(const child of Object.values(row))if(child&&typeof child==="object")queue.push({node:child,scope,depth:depth+1});
  }
  if(!identities||!matchedArticle)return fail("공식 응답의 시작 법령 또는 정확한 조문 구조 미확인");
  const found=[...links.values()].sort((a,b)=>a.serial.localeCompare(b.serial));
  if(malformed)return {status:"PARTIAL",links:found,reason:"행정규칙 연결 행 일부를 정확히 식별하지 못함"};
  return {status:found.length?"LINKS_FOUND":"NO_LINK_IN_RESPONSE",links:found,reason:found.length?"공식 연결 목록 등재 확인(원문·효력 별도 검증)":"해당 응답 범위에서 위임행정규칙 연결 미확인(부존재 단정 금지)"};
}
