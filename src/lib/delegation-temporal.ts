/** 현행 3단비교/고시 대조의 시행시점 교차검증 게이트 (과거법을 추정하지 않는다). */
export interface TemporalCheck {
  status: "current_notice" | "not_verified"
  effectiveDate?: string
  reason: string
}
export function checkDelegationTemporalContext(
  noticeText: string,
  todayKst: string,
  asOf?: string,
): TemporalCheck {
  if (asOf && asOf !== todayKst) {
    return { status: "not_verified", reason: "3단비교는 현행 법령만 반환하므로 과거·미래 기준일의 법률·시행령·고시를 동일시점 자료로 교차검증할 수 없습니다." }
  }
  if (noticeText.includes("⚠️ 연혁본") || /\[NOT_FOUND\]/.test(noticeText)) {
    return { status: "not_verified", reason: "행정규칙 연혁본 또는 원문 미확인 — 현행자료 교차검증을 보류합니다." }
  }
  const dateMatch = noticeText.match(/^시행일:\s*(\d{4})\.(\d{2})\.(\d{2})\s*$/m)
  if (!dateMatch) return { status: "not_verified", reason: "행정규칙 현행본의 시행일을 확인할 수 없어 날짜 일치를 검증하지 못했습니다." }
  const effectiveDate = dateMatch[1] + dateMatch[2] + dateMatch[3]
  if (effectiveDate > todayKst) return { status: "not_verified", effectiveDate, reason: "고시 시행일이 현재 기준일보다 미래입니다. 시행 전 고시 본문을 현행 근거로 사용하지 않습니다." }
  return { status: "current_notice", effectiveDate, reason: "고시의 표시 시행일이 오늘 이전 또는 당일입니다. 법률·시행령 3단비교와 고시 본문의 개별 개정시점 동일성은 별도 미검증입니다." }
}
