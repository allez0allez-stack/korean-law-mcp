/** Live law evidence, independent of the supplied FSS form snapshot. */
import type {LawApiClient} from '../lib/api-client.js'
import type {ToolResponse} from '../lib/types.js'
import {getLawText} from './law-text.js'
import {searchAdminRule,getAdminRule} from './admin-rule.js'
import {todayKst} from '../lib/law-lineage.js'
import {rethrowIfFatal} from '../lib/fatal-errors.js'
const RULE='증권의 발행 및 공시 등에 관한 규정'
const LAW='자본시장과 금융투자업에 관한 법률'
const CB_TOPICS={issuance:'제5-21조',pricing:'제5-22조',refixing_down:'제5-23조',refixing_up:'제5-23조의2',option_disclosure:'제4-4조',option_attachments:'제4-5조'} as const
export const FSS_TOPICS=['filing','attachments','issuance','pricing','refixing_down','refixing_up','option_disclosure','option_attachments'] as const
export type FssLinkInput={instrument:'CB'|'BW'|'EB';topic:typeof FSS_TOPICS[number]}
type Deps={law?:typeof getLawText;search?:typeof searchAdminRule;read?:typeof getAdminRule;today?:()=>string}
function validDate(s:string){return /^\d{8}$/.test(s)&&Number.isFinite(Date.parse(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`))&&new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`).toISOString().slice(0,10).replace(/-/g,'')===s}
function findExactRule(text:string){
 const blocks=text.split(/(?=^\d+\.\s)/m)
 const matches=blocks.filter(b=>b.split(/\r?\n/)[0]?.replace(/^\d+\.\s+/,'').trim()===RULE&&/^\s*- 소관부처:\s*금융위원회\s*$/m.test(b)&&/^\s*- 구분:\s*고시\s*$/m.test(b))
 if(matches.length!==1)return undefined
 const id=/행정규칙일련번호:\s*(\d{13})\b/.exec(matches[0])?.[1]
 const date=/시행일:\s*(\d{8})\b/.exec(matches[0])?.[1]??/발령일:\s*(\d{8})\b/.exec(matches[0])?.[1]
 return id&&date&&validDate(date)?{id,date}:undefined
}
function evidence(text:string,name:string,jo:string,kind:'law'|'rule',today:string,expectedDate?:string){
 const lines=text.split(/\r?\n/)
 const prefix=kind==='law'?'법령명: ':'행정규칙명: '
 if(lines[0]!==prefix+name||kind==='rule'&&!lines.includes('소관부처: 금융위원회'))return undefined
 const ef=lines.find(s=>s.startsWith('시행일: '))?.slice(5).trim().replace(/\./g,'')
 if(!ef||!validDate(ef)||ef>today||expectedDate&&ef!==expectedDate)return undefined
 // An in-body citation or a similarly numbered article is not a returned article heading.
 const heading=lines.find(s=>s.startsWith(jo+'('))
 if(!heading||/\[NOT_FOUND\]|\[NOT_VERIFIED\]|\[TRUNCATED\]|응답이 잘렸|본문이 잘렸/.test(text))return undefined
 return {title:name,article:jo,effectiveDate:ef,heading,body:text}
}
export async function fssRegulatoryLink(api:LawApiClient,input:FssLinkInput,deps:Deps={}):Promise<ToolResponse>{
 const {instrument,topic}=input,today=(deps.today??todayKst)()
 const base={instrument,topic,queriedDate:today,formSnapshotVersion:'20260930',formCurrentnessVerified:false,applicabilityVerified:false,complianceDetermined:false,formPublisher:'금융감독원',formGuideUrl:'https://dart.fss.or.kr/info/searchGuide.do'}
 const out=(status:string,detail:object,isError=false):ToolResponse=>({...(isError?{isError:true}:{}),content:[{type:'text',text:JSON.stringify({...base,status,...detail},null,2)}]})
 try{
  if(topic==='filing'||topic==='attachments'){
   const isLaw=topic==='filing',id=isLaw?'010513':'010817',name=isLaw?LAW:LAW+' 시행령',jo=isLaw?'제161조':'제171조'
   const r=await (deps.law??getLawText)(api,{lawId:id,jo});const e=!r.isError&&evidence(r.content[0]?.text??'',name,jo,'law',today)
   return e?out('OFFICIAL_ARTICLE_RETRIEVED',{authority:isLaw?'법률':'대통령령',lawId:id,evidence:[e],note:'조회시점 법령 본문. 발행결정일 및 부칙에 따른 적용 여부 별도 확인.'}):out('NOT_VERIFIED',{reason:'정확 법령명·조문·시행일 검증 실패'},true)
  }
  if(instrument==='EB')return out('NO_VERIFIED_MAPPING',{reason:'CB/BW 가격조정 및 매수선택권 준용을 EB에 자동 적용하지 않습니다. 별도 EB 관련 법적 근거 확인 필요.'})
  const jo=CB_TOPICS[topic]
  if(!jo)return out('NOT_VERIFIED',{reason:'지원하지 않는 검토 항목'},true)
  const found=await (deps.search??searchAdminRule)(api,{query:RULE,display:10})
  const exact=!found.isError&&findExactRule(found.content[0]?.text??'')
  if(!exact||exact.date>today)return out('NOT_VERIFIED',{reason:'금융위원회 고시 정확 명칭·소관·시행일·일련번호 식별 실패'},true)
  const refs=instrument==='BW'?[topic==='option_disclosure'||topic==='option_attachments'?'제4-4조':'제5-24조',jo]:[jo]
  const results=[];const missing=[]
  for(const article of new Set(refs)){
   const r=await (deps.read??getAdminRule)(api,{id:exact.id,jo:article})
   const e=!r.isError&&evidence(r.content[0]?.text??'',RULE,article,'rule',today,exact.date)
   if(e)results.push(e);else missing.push(article)
  }
  return out(missing.length?'PARTIAL':'OFFICIAL_ARTICLE_RETRIEVED',{authority:'금융위원회 고시',serial:exact.id,sourceUrl:`https://www.law.go.kr/admRulInfoP.do?admRulSeq=${exact.id}`,evidence:results,missingArticles:missing,note:instrument==='BW'?'제5-24조 및 제4-4조제4항의 준용 범위를 확인하십시오. 제5-22조는 제1항만 준용하는 등 CB 전문을 모두 BW에 적용하지 않습니다.':'공시서식 스냅샷과 고시는 별도 자료입니다. 발행시점 및 부칙 적용 여부 별도 확인.'},!results.length)
 }catch(error){rethrowIfFatal(error);return out('NOT_VERIFIED',{reason:'공식 법령 조회 실패'},true)}
}
