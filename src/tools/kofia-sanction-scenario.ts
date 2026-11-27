/** Fixed supplied Annex 1 (20261112). Explicit assumptions, never a committee determination. */
import { z } from 'zod'
import type { LawApiClient } from '../lib/api-client.js'
import type { ToolResponse } from '../lib/types.js'
import { KofiaSanctionBaseSchema, calculateKofiaBase } from './kofia-sanction-base.js'
import { lockupBenefitScenario } from './kofia-lockup-benefit.js'
import { groupSanctionReview, ventureRedemptionBase } from './kofia-sanction-group.js'
import { aggravationLimits, bondBase, lockupCompliance } from './kofia-sanction-evidence.js'

const nat = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const pos = nat.min(1)
const bps = nat.max(10_000)
const ipoKinds = ['ipo_nonpayment','ipo_lockup','ipo_payment_capacity','ipo_false_information','ipo_proxy_subscription','ipo_manager_size','ipo_manager_other','ipo_related_underwriter'] as const
const lockup = z.object({allocated:pos,committed:pos,days:pos.max(4000),balances:z.array(nat).max(4000),offer_price_krw:pos,repurchased_within_period:z.boolean(),assume_committee_approval:z.literal(true)}).strict()
const common = {version:z.literal('20261112'),designation_count_including_current:pos,apply_repeat_aggravation:z.boolean(),general_mitigation_bps:bps,assume_general_mitigation_approval:z.boolean()}
const reviewCase=z.object({case_id:z.string().min(1).max(200),security_id:z.string().min(1).max(200),event_date:z.string(),restriction_months:z.number().min(0).max(48)}).strict()
export const KofiaSanctionScenarioSchema = z.discriminatedUnion('market',[
  z.object({version:z.literal('20261112'),market:z.literal('group_review'),cases:z.array(reviewCase).min(1).max(1000),assume_same_person:z.literal(true),already_decided:z.object({months:nat,decision_date:z.string(),case_ids:z.array(z.string()).min(1).max(1000),recomputed_total_months:nat}).strict().optional()}).strict(),
  z.object({version:z.literal('20261112'),market:z.literal('venture_redemption'),redemption_krw:pos,subscription_krw:pos,other_withdrawals_krw:nat}).strict(),
  z.object({version:z.literal('20261112'),market:z.literal('cornerstone'),violation:z.enum(['cornerstone_nonpayment','cornerstone_lockup']),violation_amount_krw:pos}).strict(),
  z.object({version:z.literal('20261112'),market:z.literal('cornerstone_discretionary'),violation:z.enum(['confidentiality','false_information','fairness'])}).strict(),
  z.object({version:z.literal('20261112'),market:z.literal('lockup_benefit'),allocatedShares:pos,offerPriceKrw:pos,sales:z.array(z.object({shares:pos,priceKrw:pos}).strict()).min(1).max(10000),remedialPurchases:z.array(z.object({shares:pos,priceKrw:pos}).strict()).max(10000),reference:z.object({mode:z.enum(['end_close','three_session_average']),closesKrw:z.array(pos).min(1).max(3)}).strict()}).strict(),
  z.object({...common,market:z.literal('ipo'),violation:z.enum(ipoKinds),violation_amount_krw:pos,economic_benefit_krw:nat,listing_day_lockup:z.boolean(),apply_listing_day_aggravation:z.boolean(),lockup_mitigation:lockup.optional(),payment_capacity_occurrence_count_1y:pos.optional(),intent_or_gross_negligence:z.boolean().optional(),false_material:z.boolean().optional(),committee_other_exclusion:z.boolean().optional()}).strict(),
  z.object({...common,market:z.literal('bond'),violation:z.enum(['nonpayment','article_17_2_1_3_or_9']),violation_amount_krw:pos,declared_issue_amount_krw:pos,prior_designation_within_1y:z.boolean(),assume_minor_result:z.boolean()}).strict(),
])
type Input = z.infer<typeof KofiaSanctionScenarioSchema>
type Rat = {n:bigint,d:bigint}
const r = (n:number|bigint,d:number|bigint=1):Rat => ({n:BigInt(n),d:BigInt(d)})
const add=(a:Rat,b:Rat):Rat=>r(a.n*b.d+b.n*a.d,a.d*b.d)
const sub=(a:Rat,b:Rat):Rat=>r(a.n*b.d-b.n*a.d,a.d*b.d)
const mul=(a:Rat,b:Rat):Rat=>r(a.n*b.n,a.d*b.d)
const cmp=(a:Rat,b:Rat)=>a.n*b.d-b.n*a.d
const min=(a:Rat,b:Rat)=>cmp(a,b)<=0n?a:b
const max=(a:Rat,b:Rat)=>cmp(a,b)>=0n?a:b
const num=(a:Rat)=>Number(a.n)/Number(a.d)
const round=(a:Rat)=>Number((2n*a.n+a.d)/(2n*a.d))
const source={version:'20261112',locator:'별표 1 I.1~3, II.1~3, III.1',sha256:'8ce007dcf5fc56bc2d4f7f861720f84697bd5df93b5ffdb84f7bed00f2995fc2',url:'https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq=1820&seq=140'}
function requireFact(ok:boolean,message:string):asserts ok {if(!ok)throw new RangeError(message)}
export async function kofiaSanctionScenario(_api:LawApiClient,input:Input):Promise<ToolResponse>{
  try {
    const p=KofiaSanctionScenarioSchema.parse(input)
    if(p.market==='cornerstone'||p.market==='cornerstone_discretionary'||p.market==='lockup_benefit'){
      const details=p.market==='cornerstone'?calculateKofiaBase(KofiaSanctionBaseSchema.parse({version:p.version,violation:p.violation,violation_amount_krw:p.violation_amount_krw})):p.market==='cornerstone_discretionary'?{violation:p.violation,maxMonths:12,scenarioMonths:null,committeeDecisionRequired:true}:lockupBenefitScenario(p)
      const annex2=p.market!=='lockup_benefit'
      return {content:[{type:'text',text:'[PARTIAL] [SANCTION_SCENARIO_ONLY]\n'+JSON.stringify({source:annex2?{...source,locator:'별표 1-2 표',sha256:'e704ddf599693b9891ffd5066c8a853ee958ddc0f40a924055b8192388e514e0'}:{...source,locator:'별표 1 I.3(4)'},legalEffectVerified:false,committeeDecisionVerified:false,finalSanctionDetermined:false,warnings:[annex2?'별표 1-2에는 별표 1의 가중·감면 산식을 자동 준용하지 않음. 행위시 적용례와 위원회 판단 미검증.':'거래·기준일 및 손익 조정 미검증.'],details},null,2)}]}
    }
    if(p.market==='group_review'||p.market==='venture_redemption'){
      const details=p.market==='group_review'?groupSanctionReview(p.cases,p.already_decided):ventureRedemptionBase(p.redemption_krw,p.subscription_krw,p.other_withdrawals_krw)
      return {content:[{type:'text',text:'[PARTIAL] [SANCTION_SCENARIO_ONLY]\n'+JSON.stringify({source:{...source,locator:details.locator},legalEffectVerified:false,committeeDecisionVerified:false,finalSanctionDetermined:false,warnings:['동일인·행위시 적용례·사실관계·개별 기간 및 재산정 총기간 미검증. 금전 제재와 기간을 혼합 합산하지 않음.'],details},null,2)}]}
    }
    requireFact(!p.general_mitigation_bps||p.assume_general_mitigation_approval,'일반 감경은 위원회 승인 가정이 필요합니다.')
    requireFact(!p.apply_repeat_aggravation||p.designation_count_including_current>=2,'가중 횟수 미충족')
    const warnings:string[]=['행위시 적용례·사실관계·현행성·위원회 판단 미검증. 실제 제재 확정 아님.']
    let details:unknown
    if(p.market==='bond'){
      requireFact(p.violation_amount_krw<=p.declared_issue_amount_krw,'위반금액이 신고 발행금액 초과')
      requireFact(p.general_mitigation_bps<=5000,'무보증사채 감경은 50% 이내')
      requireFact(!p.general_mitigation_bps||(!p.prior_designation_within_1y&&p.assume_minor_result),'최근 1년 미지정 및 경미성 가정 필요')
      const base=p.violation==='nonpayment'?bondBase(p.violation_amount_krw,p.declared_issue_amount_krw).baseMonths:1
      const extra=p.apply_repeat_aggravation?aggravationLimits('bond',p.designation_count_including_current,false).repeatBondMonths:0
      const before=base+extra, months=round(mul(r(before),r(10000-p.general_mitigation_bps,10000)))
      details={baseMonths:base,repeatAddedMonths:extra,preMitigationMonths:before,scenarioMonths:months,paymentStandardKrw:months*10_000_000,paymentEligibilityVerified:false}
    }else{
      requireFact(!p.listing_day_lockup||p.violation==='ipo_lockup','상장일 확약위반은 ipo_lockup 전용')
      requireFact(!p.apply_listing_day_aggravation||p.listing_day_lockup,'상장일 위반 사실 필요')
      requireFact(!p.lockup_mitigation||p.violation==='ipo_lockup','확약 감면은 ipo_lockup 전용')
      const base=calculateKofiaBase(KofiaSanctionBaseSchema.parse({version:p.version,violation:p.violation,violation_amount_krw:p.violation_amount_krw}))
      const kind=p.violation==='ipo_nonpayment'||p.violation==='ipo_payment_capacity'||p.violation==='ipo_lockup'?p.violation:'ipo_other'
      const limits=aggravationLimits(kind,p.designation_count_including_current,p.listing_day_lockup)
      const repeat=p.apply_repeat_aggravation?limits.repeatPercent:0, listing=p.apply_listing_day_aggravation?limits.listingDayPercent:0
      let ratio=r(0), compliance:null|ReturnType<typeof lockupCompliance>=null
      if(p.lockup_mitigation){const l=p.lockup_mitigation;compliance=lockupCompliance(l.allocated,l.committed,l.days,l.balances,l.offer_price_krw)
        requireFact(compliance.violationAmountKrw===p.violation_amount_krw,'잔고 기반 위반금액 불일치')
        requireFact(l.repurchased_within_period||compliance.meets80Percent,'재매수 또는 준수율 80% 요건 미충족')
        ratio=r(BigInt(compliance.numerator),BigInt(compliance.denominator))
        warnings.push('확약 감면은 준수율 전액을 적용한다는 가정; 위원회가 그 이내에서 결정.')
      }
      const mitigation=!!p.general_mitigation_bps||!!p.lockup_mitigation
      // Source unambiguously removes base cap for mitigation-only. Combined cap/aggregation is reported as explicit alternatives, not decided.
      const cap=r(limits.finalCapMonths!), benefitProtected=r(Math.floor(p.economic_benefit_krw/5_000_000))
      const cases=[]
      for(const rounding of ['floor','ceil'] as const){
        const raw=rounding==='floor'?base.uncappedFloorMonths:base.uncappedCeilMonths, capped=rounding==='floor'?base.cappedFloorMonths:base.cappedCeilMonths
        const starts=mitigation&&(repeat||listing)&&raw!==capped?[{name:'uncapped',months:raw},{name:'base_capped',months:capped}]:[{name:mitigation?'uncapped':'base_capped',months:mitigation?raw:capped}]
        for(const start of starts)for(const stacking of repeat&&listing?['additive','sequential'] as const:['additive'] as const){
          const first=r(start.months), lockReduction=mul(first,ratio), lockApplied=max(r(0),sub(lockReduction,benefitProtected)), protectedUsed=sub(lockReduction,lockApplied)
          const afterLock=sub(first,lockApplied), repeatAdd=mul(afterLock,r(repeat,100)), listingBase=stacking==='sequential'?add(afterLock,repeatAdd):afterLock
          const listingAdd=listing?max(r(1),mul(listingBase,r(listing,100))):r(0)
          const aggravated=add(add(afterLock,repeatAdd),listingAdd)
          const cappedAggravated=repeat||listing?min(cap,aggravated):aggravated
          // Both possible cap timings when a cap binds with general mitigation.
          const capModes=p.general_mitigation_bps&&cmp(aggravated,cappedAggravated)>0n?['before_general','after_general'] as const:['before_general'] as const
          for(const capMode of capModes){const beforeGeneral=capMode==='before_general'?cappedAggravated:aggravated
            const generalReduction=mul(beforeGeneral,r(p.general_mitigation_bps,10000)), protectedRemaining=max(r(0),sub(benefitProtected,protectedUsed)), generalApplied=max(r(0),sub(generalReduction,protectedRemaining))
            const afterGeneral=sub(beforeGeneral,generalApplied), end=min(cap,afterGeneral)
            const months=mitigation?round(end):num(end)
            const eligible=months<=3&&months>0
            cases.push({rounding,baseCapAssumption:start.name,stacking,capMode,startMonths:start.months,lockupReductionMonths:num(lockReduction),lockupAppliedMonths:num(lockApplied),repeatAddedMonths:num(repeatAdd),listingAddedMonths:num(listingAdd),preGeneralMonths:num(beforeGeneral),generalAppliedMonths:num(generalApplied),unroundedMonths:num(end),scenarioMonths:months,paymentReviewThresholdMet:eligible,paymentScenarioKrw:eligible?{millionUnitFloor:Math.max(months*5_000_000,Math.floor(p.economic_benefit_krw/1_000_000)*1_000_000),retainRemainder:Math.max(months*5_000_000,p.economic_benefit_krw<1_000_000?0:p.economic_benefit_krw)}:null})
          }
        }
      }
      if(base.incompleteUnitUnresolved)warnings.push('가산단위 미만 절사·올림 가정 병기')
      if(repeat&&listing)warnings.push('두 가중의 합산/순차 방식 원문 불명확: 가정별 표시')
      if(mitigation&&(repeat||listing))warnings.push('가중·감면 경합 시 기본상한 및 가중상한 적용 시점은 가정별 표시; 경제적 이익 감면 제외분은 확약 우선 차감 가정')
      if(!mitigation&&cases.some(c=>!Number.isInteger(c.scenarioMonths)))warnings.push('감경 없는 월 미만 기간의 처리 미확정; 소수 그대로 표시')
      const exemptionFacts=[p.payment_capacity_occurrence_count_1y,p.intent_or_gross_negligence,p.false_material,p.committee_other_exclusion]
      const exemptionReview=p.violation!=='ipo_payment_capacity'?'NOT_APPLICABLE':exemptionFacts.some(x=>x===undefined)?'FACTS_INCOMPLETE':p.payment_capacity_occurrence_count_1y===1&&!p.intent_or_gross_negligence&&!p.false_material&&!p.committee_other_exclusion?'COMMITTEE_MAY_EXEMPT':'NO_SPECIAL_EXEMPTION_UNDER_ASSUMED_FACTS'
      details={base,compliance,limits,economicBenefitKrw:p.economic_benefit_krw,exemptionReview,scenarios:cases}
    }
    return {content:[{type:'text',text:'[PARTIAL] [SANCTION_SCENARIO_ONLY]\n'+JSON.stringify({source,legalEffectVerified:false,committeeDecisionVerified:false,finalSanctionDetermined:false,warnings,details},null,2)}]}
  }catch(e){return {isError:true,content:[{type:'text',text:'[NOT_VERIFIED] '+(e instanceof Error?e.message:'Invalid scenario input')}]}}
}
