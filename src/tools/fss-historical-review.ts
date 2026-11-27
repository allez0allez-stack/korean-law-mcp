/** Date-specific evidence routing; no determination of transitional legal effect. */
import {z} from 'zod'
import type {LawApiClient} from '../lib/api-client.js'
import type {ToolResponse} from '../lib/types.js'
import {fetchAdminRuleHistory,adminVersionAt} from '../lib/admin-rule-history.js'
import {todayKst} from '../lib/law-lineage.js'
import {applicableLaw,normalizeDate} from './applicable-law.js'
import {getAdminRule} from './admin-rule.js'
import {FSS_TOPICS} from './fss-regulatory-link.js'
import {rethrowIfFatal} from '../lib/fatal-errors.js'
const RULE='증권의 발행 및 공시 등에 관한 규정',LAW='자본시장과 금융투자업에 관한 법률'
const articles={issuance:'제5-21조',pricing:'제5-22조',refixing_down:'제5-23조',refixing_up:'제5-23조의2',option_disclosure:'제4-4조',option_attachments:'제4-5조'} as const
const ymd=z.string().regex(/^\d{8}$/).refine(s=>normalizeDate(s)===s,'Invalid calendar date')
export const HistoricalReviewSchema=z.object({mode:z.literal('historical_basis'),instrument:z.enum(['CB','BW','EB']),topic:z.enum(FSS_TOPICS),event_date:ymd,event_kind:z.enum(['board_resolution','issuance','payment','option_exercise','price_adjustment','filing']),transition_serial:z.string().regex(/^\d{13}$/).optional(),transition_keyword:z.string().trim().min(1).max(100).optional()}).strict()
type Input=z.infer<typeof HistoricalReviewSchema>
type Deps={history?:typeof fetchAdminRuleHistory;read?:typeof getAdminRule;law?:typeof applicableLaw;today?:()=>string}
export async function historicalMezzanineBasis(api:LawApiClient,p:Input,d:Deps={}):Promise<ToolResponse>{
 const today=(d.today??todayKst)(),base={instrument:p.instrument,topic:p.topic,eventDate:p.event_date,eventKind:p.event_kind,queriedDate:today,applicabilityVerified:false,transitionalEffectVerified:false,complianceDetermined:false,formCurrentnessVerified:false}
 const out=(status:string,data:object={},error=false):ToolResponse=>({...(error?{isError:true}:{}),content:[{type:'text',text:JSON.stringify({...base,status,...data},null,2)}]})
 if(normalizeDate(p.event_date)!==p.event_date||p.event_date>today)return out('NOT_VERIFIED',{reason:'Invalid or future event date'},true)
 try{
  if(p.topic==='filing'||p.topic==='attachments'){
   if(p.transition_serial||p.transition_keyword)return out('NOT_VERIFIED',{reason:'Administrative-rule transition filters are not supported for statutory topics'},true)
   const lawName=p.topic==='filing'?LAW:LAW+' 시행령',jo=p.topic==='filing'?'제161조':'제171조'
   const result=await (d.law??applicableLaw)(api,{lawName,date:p.event_date,jo})
   return out(result.isError?'NOT_VERIFIED':'STATUTORY_DATE_REVIEW_EVIDENCE',{lawName,article:jo,rawEvidence:result.content[0]?.text??'',versionSelectionDelegated:true,note:'기존 행위시법 분석 원문을 반환합니다. 발췌·부분 실패 및 부칙을 확인하십시오.'},!!result.isError)
  }
  if(p.instrument==='EB')return out('NO_VERIFIED_MAPPING',{reason:'EB에 CB/BW 특례를 자동 준용하지 않음'})
  const hist=await (d.history??fetchAdminRuleHistory)(api,RULE),group=hist.groups.get('36044')
  if(hist.truncated||!group?.length||hist.totalCount!==[...hist.groups.values()].reduce((n,g)=>n+g.length,0)||group.some(v=>v.name!==RULE||v.org!=='금융위원회'||v.kind!=='고시'||!/^\d{13}$/.test(v.serial)||normalizeDate(v.efYd)!==v.efYd||normalizeDate(v.issuedYd)!==v.issuedYd))return out('NOT_VERIFIED',{reason:'Incomplete or inconsistent official administrative-rule lineage'},true)
  const state=adminVersionAt(group,p.event_date),v=state.version
  if(!v||state.note)return out('NOT_VERIFIED',{reason:state.note??'No in-force version found',abolished:state.abolished??null},true)
  const same=group.filter(x=>x.serial!==v.serial&&x.efYd<=p.event_date&&x.issuedYd===v.issuedYd&&x.issuedNo===v.issuedNo)
  if(same.length)return out('NOT_VERIFIED',{reason:'Ambiguous same-promulgation version'},true)
  const later=group.filter(x=>x.efYd>p.event_date&&x.efYd<=today).sort((a,b)=>a.efYd.localeCompare(b.efYd))
  const transition=[v,...later].find(x=>x.serial===(p.transition_serial??v.serial))
  if(!transition)return out('NOT_VERIFIED',{reason:'Transition serial must be selected version or a later effective version in the same verified lineage'},true)
  const jo=articles[p.topic],refs=p.instrument==='BW'?[p.topic==='option_disclosure'||p.topic==='option_attachments'?'제4-4조':'제5-24조',jo]:[jo]
  const header=(s:string,date:string)=>s.startsWith('행정규칙명: '+RULE+'\n')&&s.split(/\r?\n/).includes('소관부처: 금융위원회')&&s.split(/\r?\n/).some(l=>l.startsWith('시행일: ')&&l.slice(5).replace(/\./g,'').trim()===date)
  const evidence=[],missing=[]
  for(const article of new Set(refs)){const r=await (d.read??getAdminRule)(api,{id:v.serial,jo:article}),s=r.content[0]?.text??'';if(!r.isError&&header(s,v.efYd)&&s.split(/\r?\n/).some(l=>l.startsWith(article+'('))&&!/\[NOT_FOUND\]|\[NOT_VERIFIED\]|\[PARTIAL\]|\[TRUNCATED\]|응답이 잘렸|본문이 잘렸/.test(s))evidence.push({article,body:s});else missing.push(article)}
  const tr=await (d.read??getAdminRule)(api,{id:transition.serial,transition_date:p.event_date,...(p.transition_keyword?{transition_keyword:p.transition_keyword}:{})}),raw=tr.content[0]?.text??''
  const transitionEvidence=!tr.isError&&header(raw,transition.efYd)&&raw.includes('[ADMIN_TRANSITION_DATE_COMPARISON] 지정 문서 '+transition.serial+' | 기준일 '+p.event_date+' | 문서 시행일 '+transition.efYd)?raw:null
  return out(!evidence.length?'NOT_VERIFIED':'HISTORICAL_ARTICLE_REVIEW_EVIDENCE',{ruleId:'36044',selectedVersion:v,sourceUrl:`https://www.law.go.kr/admRulInfoP.do?admRulSeq=${v.serial}`,evidence,missingArticles:missing,laterEffectiveVersions:later.map(x=>({serial:x.serial,effectiveDate:x.efYd,issuedNo:x.issuedNo})),transitionVersion:transition,transitionEvidence,transitionReviewStatus:!transitionEvidence?'NOT_VERIFIED':/\[PARTIAL\]|\[NOT_VERIFIED\]|\[TRUNCATED\]/.test(transitionEvidence)?'PARTIAL':'EXCERPTS_ONLY',allLaterTransitionsReviewed:false,note:'시행 버전 선정과 부칙 발췌는 법적 적용 판정이 아닙니다. 이후 개정 부칙은 transition_serial로 각각 조회하십시오. BW 준용 범위와 과거 조문 내용 별도 확인.'},!evidence.length)
 }catch(error){rethrowIfFatal(error);return out('NOT_VERIFIED',{reason:'Official historical lookup failed'},true)}
}
