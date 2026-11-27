/** Fixed-version arithmetic only, based on user-provided Annex 1 and 1-2 originals. */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"

const RULES = {
  ipo_nonpayment: [6, 50_000_000, 24, "미청약·미납입 주식수 × 공모가격"],
  ipo_lockup: [6, 150_000_000, 12, "의무보유 확약위반 주식수 × 공모가격"],
  ipo_payment_capacity: [6, 150_000_000, 12, "배정받은 주식수 × 공모가격 (초과금액 자체 아님)"],
  ipo_false_information: [6, 50_000_000, 12, "배정받은 주식수 × 공모가격"],
  ipo_proxy_subscription: [6, 50_000_000, 12, "대리청약 처분이익"],
  ipo_manager_size: [6, 50_000_000, 24, "신청한 주식수 × 공모가격"],
  ipo_manager_other: [6, 50_000_000, 6, "배정받은 주식수 × 공모가격"],
  ipo_related_underwriter: [6, 50_000_000, 12, "배정받은 주식수 × 공모가격"],
  cornerstone_nonpayment: [12, 50_000_000, 48, "미청약·미납입 주식수 × 공모가격"],
  cornerstone_lockup: [12, 50_000_000, 48, "의무보유등록위반 주식수 × 공모가격"],
} as const
const kinds = Object.keys(RULES) as [keyof typeof RULES, ...(keyof typeof RULES)[]]
export const KofiaSanctionBaseSchema = z.object({
  version: z.literal("20261112").describe("사용자 제공 2026-11-12 개정본 별표만 계산; 현행성·행위시 적용 확정 아님"),
  violation: z.enum(kinds),
  violation_amount_krw: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe("해당 위반유형의 별표상 정의에 따라 별도 확인한 위반금액(원). 투자손실 또는 초과금액과 혼동 금지"),
}).strict()
type Input = z.infer<typeof KofiaSanctionBaseSchema>

export async function kofiaSanctionBase(_api: LawApiClient, input: Input): Promise<ToolResponse> {
  const parsed = KofiaSanctionBaseSchema.safeParse(input)
  if (!parsed.success) return {content:[{type:"text",text:"[NOT_VERIFIED] 고정 버전, 지원 위반유형, 양의 안전한 정수 원화 금액이 필요합니다."}],isError:true}
  const data = calculateKofiaBase(parsed.data)
  return {content:[{type:"text",text:"[PARTIAL] [BASE_SCENARIO_ONLY] 사용자 제공 고정 개정본의 기본 산정 예시입니다. 위반사실·금액·현행성·부칙 적용례·가중·감면·위원회 판단은 미검증입니다.\n"+JSON.stringify(data,null,2)+"\n잔여 단위가 있는 경우 절사/올림 가정별 결과만 표시하며 원문에 명시되지 않은 처리 방식을 확정하지 않습니다. 감면이 있는 경우 별표 1의 기본 상한 미적용 기간이 필요하므로 uncapped 값도 보존합니다. 최종 제재기간, 제재금 또는 적용 가능 여부가 아닙니다. 별표 1 I.2~3, III 및 제17조의2·제17조의3과 부칙을 별도 검토하세요."}]}
}

export function calculateKofiaBase(input: Input) {
  const {violation,violation_amount_krw: amount} = input
  const [base,step,cap,basis] = RULES[violation]
  const isCornerstone = violation.startsWith("cornerstone_")
  const excess = BigInt(Math.max(0,amount-100_000_000)), unit = BigInt(step)
  const lower = base + Number(excess/unit), remainder = Number(excess%unit)
  const upper = lower + (remainder ? 1 : 0)
  const cappedLower = Math.min(cap,lower), cappedUpper = Math.min(cap,upper)
  return {
    status:"BASE_SCENARIO_ONLY", version:"20261112", publisher:"금융투자협회", source:"증권 인수업무 등에 관한 규정",
    url:"https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq=1820&seq=140",
    locator:isCornerstone?"별표 1-2 표":"별표 1 I.1 표",
    suppliedFileSha256:isCornerstone?"e704ddf599693b9891ffd5066c8a853ee958ddc0f40a924055b8192388e514e0":"8ce007dcf5fc56bc2d4f7f861720f84697bd5df93b5ffdb84f7bed00f2995fc2",
    violation, amountBasis:basis, amountKrw:amount, thresholdKrw:100_000_000, stepKrw:step, baseMonths:base, baseCapMonths:cap,
    uncappedFloorMonths:lower, uncappedCeilMonths:upper, cappedFloorMonths:cappedLower, cappedCeilMonths:cappedUpper,
    remainderKrw:remainder, incompleteUnitUnresolved:remainder!==0,
    legalEffectVerified:false, currentnessVerified:false, aggravationOrMitigationCalculated:false,
  }
}
