import {describe,it,expect,vi} from 'vitest'
import type {LawApiClient} from '../lib/api-client.js'
import type {AdminRuleVersion} from '../lib/admin-rule-history.js'
import type {GetAdminRuleInput} from './admin-rule.js'
import {HistoricalReviewSchema,historicalMezzanineBasis} from './fss-historical-review.js'
const api={} as LawApiClient, name='증권의 발행 및 공시 등에 관한 규정'
const make=(serial:string,efYd:string,issuedYd=efYd):AdminRuleVersion=>({serial,ruleId:'36044',name,kind:'고시',issuedYd,issuedNo:serial,efYd,rrCls:'일부개정',org:'금융위원회',isCurrent:false})
const old=make('2100000283270','20260728'),next=make('2100000287734','20261113','20261103')
const d=()=>({today:()=> '20261127',history:vi.fn(async()=>({groups:new Map([['36044',[next,old]]]),totalCount:2,truncated:false})),read:vi.fn(async(_api:LawApiClient,p:GetAdminRuleInput)=>{const v=p.id===old.serial?old:next;const header=`행정규칙명: ${name}\n시행일: ${v.efYd.slice(0,4)}.${v.efYd.slice(4,6)}.${v.efYd.slice(6)}\n소관부처: 금융위원회\n`;return {content:[{type:'text',text:header+(p.jo?`${p.jo}(조문)\n본문`:`[ADMIN_TRANSITION_DATE_COMPARISON] 지정 문서 ${v.serial} | 기준일 ${p.transition_date} | 문서 시행일 ${v.efYd}\n[PARTIAL] 첨부파일 미열람`)}]}})})
const p=HistoricalReviewSchema.parse({mode:'historical_basis',instrument:'CB',topic:'pricing',event_kind:'board_resolution',event_date:'20261027'})
const run=async(input=p,deps=d())=>JSON.parse((await historicalMezzanineBasis(api,input,deps)).content[0].text)
describe('historical mezzanine official evidence',()=>{
 it('selects historical version and lists later amendment, partial transition remains partial',async()=>{const deps=d();const r=await run(p,deps);expect(r.selectedVersion.serial).toBe(old.serial);expect(r.laterEffectiveVersions[0].serial).toBe(next.serial);expect(r.transitionReviewStatus).toBe('PARTIAL');expect(r.applicabilityVerified).toBe(false);expect(deps.read).toHaveBeenCalledWith(api,{id:old.serial,jo:'제5-22조'})})
 it('selects new version on boundary',async()=>expect((await run({...p,event_date:'20261113'})).selectedVersion.serial).toBe(next.serial))
 it('allows explicit later same-lineage transition but not unrelated serial',async()=>{expect((await run({...p,transition_serial:next.serial})).transitionVersion.serial).toBe(next.serial);expect((await run({...p,transition_serial:'2100000000000'})).status).toBe('NOT_VERIFIED')})
 it('blocks incomplete history, inconsistent count, future event and EB mapping',async()=>{const deps=d();deps.history.mockResolvedValueOnce({groups:new Map([['36044',[old]]]),totalCount:2,truncated:false});expect((await run(p,deps)).status).toBe('NOT_VERIFIED');expect((await run({...p,event_date:'20261201'})).status).toBe('NOT_VERIFIED');expect((await run({...p,instrument:'EB'})).status).toBe('NO_VERIFIED_MAPPING')})
 it('blocks article mismatch and invalid date',async()=>{const deps=d();deps.read.mockResolvedValueOnce({content:[{type:'text',text:'제5-22조 인용'}]});expect((await run(p,deps)).status).toBe('NOT_VERIFIED');expect(HistoricalReviewSchema.safeParse({...p,event_date:'20260230'}).success).toBe(false)})
 it('queries BW incorporation separately',async()=>{const deps=d();await run({...p,instrument:'BW'},deps);expect(deps.read).toHaveBeenCalledWith(api,{id:old.serial,jo:'제5-24조'});expect(deps.read).toHaveBeenCalledWith(api,{id:old.serial,jo:'제5-22조'})})
})
