/** Review-only arithmetic. Article 17-2(4),(5),(8),(9) verified at historySeq=1820.
 * Annex adjustment/benefit formulas are secondary prospectus evidence, not verified against 20261112 HWP.
 * No automatic legal eligibility, version selection, committee decision or final sanction. */
export interface AdjustmentInput {
  preMitigationMonths: number
  proposedMitigationMonths: number
  economicBenefitKrw: number
  membership: 'member' | 'nonmember' | 'unknown'
}
export function reviewKofiaAdjustment(input: AdjustmentInput) {
  const {preMitigationMonths: before, proposedMitigationMonths: reduction, economicBenefitKrw: benefit, membership} = input
  if (![before, reduction, benefit].every(v => Number.isSafeInteger(v) && v >= 0) || reduction > before || before > Math.floor(Number.MAX_SAFE_INTEGER / 5_000_000) || !['member','nonmember','unknown'].includes(membership)) throw new RangeError('Invalid review input: nonnegative safe integers, mitigation <= starting months, valid membership required')
  const protectedMonths = Math.min(reduction, Math.floor(benefit / 5_000_000))
  const appliedMitigationMonths = reduction - protectedMonths
  const scenarioMonths = before - appliedMitigationMonths
  const eligible = scenarioMonths <= 3
  const feePeriodKrw = scenarioMonths * 5_000_000
  const benefitFloorKrw = Math.floor(benefit / 1_000_000) * 1_000_000
  return {
    status: 'SECONDARY_EVIDENCE_REVIEW_ONLY',
    annexVersionVerified: false, legalEffectVerified: false, committeeDecisionVerified: false,
    source: 'KOFIA Article 17-2(4),(5),(8),(9); secondary 2026-10 prospectus annex quotation',
    preMitigationMonths: before, proposedMitigationMonths: reduction, economicBenefitKrw: benefit,
    protectedMonths, appliedMitigationMonths, scenarioMonths,
    paymentReviewThresholdMet: eligible,
    paymentRoute: !eligible ? 'ABOVE_THREE_MONTHS' : membership === 'member' ? 'COMMITTEE_SANCTION_PAYMENT_REVIEW' : membership === 'nonmember' ? 'PAYMENT_INTENT_AND_COMMITTEE_APPROVAL_REQUIRED' : 'MEMBERSHIP_UNVERIFIED',
    feeScenarioKrw: eligible ? {millionUnitFloor: Math.max(feePeriodKrw, benefitFloorKrw), retainRemainder: Math.max(feePeriodKrw, benefit < 1_000_000 ? 0 : benefit)} : null,
    proprietaryAssetsConcurrentRestrictionPossible: true,
    paymentDeadline: 'ONE_MONTH_FROM_NOTIFICATION',
    additionalRestrictionCapRatioOnNonpayment: 1,
    finalSanctionDetermined: false,
  }
}
