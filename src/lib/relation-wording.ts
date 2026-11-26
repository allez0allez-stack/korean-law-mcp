/** Literal evidence only. Neither an official listing nor a phrase determines legal effect. */
interface RelationEvidence { kind: string; wording: string }

export function classifyReferenceTail(tail: string): RelationEvidence | undefined {
  // Keep the match on the immediately following phrase, never across a clause boundary.
  const text=tail.slice(0,100).split("\n",1)[0]
  const patterns: [string, RegExp][] = [
    ["EXCEPTION_WORDING", /^\s*(?:에도\s*불구하고|(?:을|를|은|는)\s*(?:(?:적용|준용)하지\s*(?:아니한다|않는다)|(?:적용|준용)할\s*수\s*없다))/],
    ["JUNYONG_WORDING", /^\s*(?:의\s*규정\s*)?(?:을|를)\s*준용(?:한다|하며|하고|하되|할\s*수\s*있다)(?=\s|[.,;ㆍ)]|$)/],
    ["DEFINITION_WORDING", /^\s*에서\s*(?:정의한|정의하는|정한\s*용어)/],
    ["PROCEDURE_WORDING", /^\s*에\s*따른\s*(?:신고|보고|허가|인가|승인|등록|신청|통지)(?=\s|[을를은는이가에의]|$)/],
    ["APPLICATION_WORDING", /^\s*(?:을|를)\s*적용(?:한다|하며|하고|하되)(?=\s|[.,;ㆍ)]|$)/],
  ]
  for(const [kind,pattern] of patterns){const m=pattern.exec(text);if(m)return {kind,wording:m[0].trim()}}
  return undefined
}

/** Match the listed phrase in the verified source, never use uncorroborated list text as proof.
 * The source location is still an official-list location, not independently matched to a paragraph.
 */
export function listedRelationNote(body:string,wording:string,sourceType:string,targetType:string):string {
  if(body.length>100000||wording.length>500)return " | 관계문언: UNRESOLVED"
  const needle=wording.replace(/\s+/g,"")
  if(needle.length<6)return " | 관계문언: UNRESOLVED"
  const matches:string[]=[]
  for(const line of body.split("\n")){
    const text=line.replace(/\s+/g,"")
    let i=text.indexOf(needle)
    while(i>=0){
      matches.push(text.slice(i,i+needle.length+24))
      if(matches.length>1)return " | 관계문언: UNRESOLVED (복수 문언 위치)"
      i=text.indexOf(needle,i+needle.length)
    }
  }
  if(matches.length!==1)return " | 관계문언: UNRESOLVED (원문 대조 불가)"
  const text=matches[0]
  // The trigger must begin inside the original list phrase; only complete its immediate suffix.
  const authority=targetType==="대통령령"?"대통령령으로":targetType==="총리령"?"총리령으로":targetType==="부령"?"(?:[가-힣]{2,15})?부령으로":targetType==="행정규칙"?"(?:[가-힣]{2,30}(?:장관|위원회|청장|원장)이?|[가-힣]{2,30}의장이)":""
  if(!authority)return " | 관계문언: UNRESOLVED"
  const pattern=new RegExp(authority+(targetType==="행정규칙"?"(?:가)?정하여고시(?:한다|하는|할)":"정(?:한다|하는|할)"))
  const m=pattern.exec(text)
  if(!m||m.index>=needle.length)return " | 관계문언: UNRESOLVED"
  // Explicit exclusion/negation in the observed fragment is not a positive delegation signal.
  if(/(?:아니|않|제외|불구하고)/.test(text))return " | 관계문언: UNRESOLVED (예외·부정 문언 혼재)"
  const kind=sourceType==="법률"?"DELEGATION_WORDING":(sourceType==="대통령령"&&/^(?:총리령|부령|행정규칙)$/.test(targetType)||/^(?:총리령|부령)$/.test(sourceType)&&targetType==="행정규칙")?"REDELEGATION_WORDING":"UNRESOLVED"
  return " | 관계문언: "+kind+" ("+m[0]+"; 효력 미판정)"
}
