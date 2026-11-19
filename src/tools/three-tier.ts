/**
 * get_three_tier Tool - 3단비교 (법률→시행령→시행규칙)
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseThreeTierCitation } from "../lib/three-tier-citation.js"
import { parseThreeTierDelegation } from "../lib/three-tier-parser.js"
import { cleanHtml } from "../lib/article-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { lawCache } from "../lib/cache.js"
import { getAdminRule } from "./admin-rule.js"

/** 단일 정확조회에는 위임조문 전문, 광역조회에는 미리보기를 제공한다. */
export function formatDelegationBody(cleanContent: string, targeted: boolean): string {
  if (!cleanContent) return ""
  if (targeted || cleanContent.length <= 500) return `${cleanContent}\n\n`
  const lastNewline = cleanContent.lastIndexOf("\n", 500)
  const cutPos = lastNewline > 300 ? lastNewline : 500
  return `${cleanContent.substring(0, cutPos)}\n   (위임 내용 ${cleanContent.length.toLocaleString()}자 중 일부만 표시)\n\n`
}

/**
 * 3단비교 목록 등재와 하위조문 본문의 명시적 모법 인용을 구분한다.
 * 모법 직접 인용은 확인할 수 있지만 위임의 적법성·위임 범위까지 보증하지 않는다.
 * 조번호의 가지번호까지 정밀 매칭한다 (제249조의7 != 제249조의70).
 */
export function classifyDelegationEvidence(
  sourceJo: string,
  targetContent: string,
): "explicit_citation" | "listed_only" {
  const parsed = sourceJo.replace(/\s+/g, "").match(/^제(\d+)조(?:의(\d+))?$/)
  if (!parsed || !targetContent.trim()) return "listed_only"
  const article = Number(parsed[1])
  const branch = parsed[2] === undefined ? undefined : Number(parsed[2])
  // 공백이 들쭉날쭉한 법령 원문에 대응하되, 가지번호 후속 숫자의 오탐을 막는다.
  const re = /(?:^|[^가-힣A-Za-z0-9])법\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?!\s*(?:의\s*\d|\d))/g
  for (const match of targetContent.matchAll(re)) {
    const citedArticle = Number(match[1])
    const citedBranch = match[2] === undefined ? undefined : Number(match[2])
    if (citedArticle === article && citedBranch === branch) return "explicit_citation"
  }
  return "listed_only"
}

/**
 * 시행령 조문에서 고시 재위임의 명시적 문언만 탐지한다.
 * 이는 고시 제정/적법성/특정 고시와의 일치를 검증하지 않는다.
 * 하위 조문 중 해당 시행령 조문에 포함된 문언만 검사하며 모법의 위임을 추정하지 않는다.
 */
export function findSubdelegationToGazette(content: string): string[] {
  const plain = cleanHtml(content || "").replace(/\s+/g, " ")
  if (!plain) return []
  // '정하여 고시하는 서식', '정하여 고시한다' 등 명시적 문구만 허용.
  // 단순 '금융위원회가 정한다' 또는 '고시를 참조'는 재위임으로 확정하지 않는다.
  const re = /(?:금융위원회|금융위원장|금융감독원장|장관|대통령령으로 정하는 기관의 장)(?:가|이)?\s*정하여\s*고시(?:하는|한다|하도록|할)/g
  const findings: string[] = []
  for (const m of plain.matchAll(re)) {
    const start = Math.max(0, m.index - 100)
    const end = Math.min(plain.length, m.index + m[0].length + 95)
    const excerpt = plain.slice(start, end)
    // 서로 다른 재위임 문구가 근접하면 발췌 구간이 같아질 수 있으므로
    // 발췌 문자열이 아닌 정규식의 개별 매치마다 증거를 보존한다.
    findings.push(excerpt)
    if (findings.length === 8) break
  }
  return findings
}

/**
 * 읽은 고시의 본문에서 정확한 시행령 조문(영 제○조의○)을 인용한 위치만 증거로 반환한다.
 * 규정의 검색 헤더에 있는 대상 조문번호만으로는 절대 일치 판정하지 않는다.
 * 반환되는 것은 문면의 교차인용 후보이며 법적 위임범위 적합성의 판정이 아니다.
 */
export function findExplicitDecreeCitations(decreeJo: string, noticeText: string): string[] {
  const source = decreeJo.replace(/\s+/g, "").match(/^제(\d+)조(?:의(\d+))?$/)
  if (!source) return []
  const article = Number(source[1])
  const branch = source[2] === undefined ? undefined : Number(source[2])
  const pattern = /(?:^|[^가-힣A-Za-z0-9])영\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?!\s*(?:의\s*\d|\d))/g
  const findings: string[] = []
  for (const match of noticeText.matchAll(pattern)) {
    const num = Number(match[1])
    const sub = match[2] === undefined ? undefined : Number(match[2])
    if (num !== article || sub !== branch) continue
    const excerpt = noticeText.slice(Math.max(0, match.index - 60), Math.min(noticeText.length, match.index + match[0].length + 95))
      .replace(/\s+/g, " ").trim()
    findings.push(excerpt)
    if (findings.length === 4) break
  }
  return findings
}

export const GetThreeTierSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  jo: z.string().regex(/^제\s*\d+\s*조(?:의\s*\d+)?$/).optional().describe("특정 법률 조문으로 위임관계 한정 (예: 제249조의7)"),
  knd: z.enum(["1", "2"]).optional().default("2").describe("1=인용조문, 2=위임조문 (기본값)"),
  adminRuleId: z.string().regex(/^\d{13}$/).optional().describe("특정 조문 jo와 함께 고시 원문의 시행령 직접 인용 여부를 교차검증할 13자리 행정규칙일련번호 (search_admin_rule에서 확보)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetThreeTierInput = z.infer<typeof GetThreeTierSchema>

export async function getThreeTier(
  apiClient: LawApiClient,
  input: GetThreeTierInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 3단비교 응답은 조문 필터가 없어 통째로 온다(관세법 1.98 MB, JO·display 무시 실측). 같은 법령을 체인 여럿
    // (law_system·action_basis·ordinance_compare·procedure_detail)이 부르므로 렌더 결과를 캐시한다(2026-09-28 성능 감사).
    // 옛 MST 를 줘도 늘 현행 3단비교가 온다(MST 는 법령을 고를 뿐, 리뷰 실측) — 시행령·시행규칙 개정을 넘기지 않게 1시간만 둔다.
    // 체인은 스키마를 거치지 않아 knd 가 비어 온다 — 기본값 2로 맞춰 키를 하나로
    if (input.adminRuleId && (!input.jo || input.knd === "1")) {
      return { content: [{ type: "text", text: "[INVALID_ARGUMENT] adminRuleId 검증은 위임조문(knd=2)의 특정 jo와 함께 요청해야 합니다." }], isError: true }
    }
    const cacheKey = `thdcmp:${input.mst ? `m${input.mst}` : `i${input.lawId}`}:${input.knd || "2"}:${input.jo?.replace(/\s+/g, "") || "all"}`
    const cached = lawCache.get<string>(cacheKey)
    if (cached && !input.adminRuleId) return { content: [{ type: "text", text: cached }] }

    const jsonText = await apiClient.getThreeTier({
      mst: input.mst,
      lawId: input.lawId,
      knd: input.knd,
      apiKey: input.apiKey
    })
    const json = JSON.parse(jsonText)

    const threeTierData = input.knd === "1" ? parseThreeTierCitation(json) : parseThreeTierDelegation(json)

    const { meta, articles } = threeTierData

    let resultText = `법령명: ${meta.lawName}\n`
    if (meta.sihyungryungName) {
      resultText += `시행령: ${meta.sihyungryungName}\n`
    }
    if (meta.sihyungkyuchikName) {
      resultText += `시행규칙: ${meta.sihyungkyuchikName}\n`
    }
    resultText += `\n`

    if (articles.length === 0) {
      return {
        content: [{
          type: "text",
          text: resultText + "3단비교 데이터가 없습니다."
        }]
      }
    }

    // 특정 조문 요청은 원본 전체에서 정확한 조문 번호를 찾아야 한다.
    const normalizedJo = input.jo?.replace(/\s+/g, "")
    const selected = normalizedJo
      ? articles.filter(article => article.joNum.replace(/\s+/g, "") === normalizedJo)
      : articles.slice(0, 5)
    if (normalizedJo && selected.length === 0) {
      return { content: [{ type: "text", text: `${resultText}[NOT_FOUND] ${input.jo}의 3단 위임 연결이 확인되지 않았습니다. 다른 조문을 대신 반환하지 않습니다.` }] }
    }
    if (normalizedJo && selected.length > 1) {
      return { content: [{ type: "text", text: `${resultText}[AMBIGUOUS] ${input.jo}에 해당하는 조문이 ${selected.length}건입니다. 임의 선택하지 않습니다.` }] }
    }
    const maxArticles = selected.length

    for (let i = 0; i < maxArticles; i++) {
      const article = selected[i]

      resultText += `---\n`
      resultText += `${article.joNum}`
      if (article.title) resultText += ` ${article.title}`
      resultText += `\n---\n\n`

      if (threeTierData.kndType === "인용조문" && article.content) {
        const content = cleanHtml(article.content)
        resultText += content.length > 500
          ? `${content.slice(0, 500)}\n   (법률 본문 ${content.length.toLocaleString()}자 중 일부만 표시)\n\n`
          : `${content}\n\n`
      }

      if (article.delegations.length === 0) {
        if (threeTierData.kndType === "인용조문") continue
        resultText += `(위임 조문 없음)\n\n`
        continue
      }

      for (const delegation of article.delegations) {
        const typeLabel = delegation.type === "시행령" ? "[시행령]"
                        : delegation.type === "시행규칙" ? "[시행규칙]"
                        : "[행정규칙]"

        resultText += `${typeLabel} ${delegation.lawName}`
        if (delegation.joNum) resultText += ` ${delegation.joNum}`
        if (delegation.title) resultText += ` (${delegation.title})`
        resultText += `\n`

        const evidence = classifyDelegationEvidence(article.joNum, delegation.content || "")
        if (evidence === "explicit_citation") {
          resultText += "  근거상태: [본문 인용 확인] 하위 조문에 해당 법률 조문(법 제○조)이 명시됩니다. 위임의 적법성·범위는 별도 검토가 필요합니다.\n"
        } else {
          resultText += "  근거상태: [연계 목록 확인] 법제처 3단비교에 등재되었으나 하위 조문에서 해당 법률 조문의 직접 인용은 확인하지 못했습니다.\n"
        }

        if (delegation.content) {
          const cleanContent = cleanHtml(delegation.content)

          // 고시의 실제 이름·존재·적법성은 이 조문만으로 판정할 수 없다.
          // 정확조회에서만 근거 조각을 제한적으로 표시한다.
          if (normalizedJo && threeTierData.kndType === "위임조문" && delegation.type === "시행령") {
            const gazetteTexts = findSubdelegationToGazette(cleanContent)
            if (gazetteTexts.length) {
              resultText += "  재위임 문언: [고시 위임 문구 확인] 시행령 본문에서 고시 위임 표현을 확인했습니다. 특정 고시의 제정·연결·적법성은 미검증입니다.\n"
              gazetteTexts.forEach((excerpt, idx) => { resultText += `  근거 발췌 ${idx + 1}: ${excerpt}\n` })
            } else {
              resultText += "  재위임 문언: [고시 위임 문구 미확인] 이 시행령 조문의 검색 범위에서 명시적 문구를 발견하지 못했습니다. 다른 조문·간접 위임 여부는 미검증입니다.\n"
            }
          }

          resultText += formatDelegationBody(cleanContent, Boolean(normalizedJo))
        } else {
          resultText += `\n`
        }
      }
    }

    if (normalizedJo) {
      resultText += "※ 근거상태는 법제처 3단비교 등재 여부와 하위 조문 본문의 명시적 '법 제○조' 인용 여부만 구분합니다. 행정규칙의 위임 사슬·법률유보·위임범위의 충족 또는 미이행 여부를 자동 확정하지 않습니다.\n"
    }

    if (!normalizedJo && articles.length > maxArticles) {
      resultText += `\n... 외 ${articles.length - maxArticles}개 조문 (생략)\n`
      resultText += `전체 ${articles.length}개 조문 중 처음 ${maxArticles}개만 표시합니다.\n`
    }

    if (input.adminRuleId && normalizedJo && threeTierData.kndType === "위임조문") {
      resultText += "\n▶ 지정 고시 원문 교차검증 (법적 적합성 판정 아님)\n"
      const decree = selected[0]?.delegations.find(d => d.type === "시행령" && d.joNum)
      if (!decree?.joNum) {
        resultText += "[NOT_VERIFIED] 연결된 시행령의 정확한 조문번호를 확보하지 못했습니다.\n"
      } else {
        const rule = await getAdminRule(apiClient, {
          id: input.adminRuleId,
          keyword: decree.joNum,
          max_results: 5,
          apiKey: input.apiKey,
        })
        const body = rule.content[0]?.text || ""
        const ruleName = body.match(/^행정규칙명:\s*(.+)$/m)?.[1] || "확인되지 않음"
        resultText += \`조회 고시: \${ruleName} (행정규칙일련번호: \${input.adminRuleId})\n\`
        resultText += \`대조 시행령: \${decree.lawName} \${decree.joNum}\n\`
        if (rule.isError || body.includes("[NOT_FOUND]") || body.includes("⚠️ 연혁본")) {
          resultText += "[NOT_VERIFIED] 고시 본문이 확인되지 않았거나 연혁본입니다. 현행 고시의 직접 인용은 검증하지 못했습니다.\n"
        } else {
          const matches = findExplicitDecreeCitations(decree.joNum, body)
          if (matches.length) {
            resultText += \`[고시 본문 직접 인용 후보] 지정 고시에서 해당 시행령 조문을 문면 인용한 대목 \${matches.length}개를 확인했습니다.\n\`
            for (let i = 0; i < matches.length; i++) {
              resultText += \`근거 \${i + 1}: \${matches[i]}\n\`
            }
            resultText += "※ 위임 대상·범위·시행시점의 부합 여부와 고시의 적법성은 확인하지 않았습니다.\n"
          } else {
            resultText += "[직접 인용 미확인] 조회한 고시의 최대 5개 검색 조문에서 해당 시행령 조문 직접 인용을 발견하지 못했습니다. 부존재 또는 미이행을 단정하지 마세요.\n"
          }
        }
      }
    }

    const text = truncateResponse(resultText)
    if (!input.adminRuleId) lawCache.set(cacheKey, text, 60 * 60 * 1000)
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return formatToolError(error, "get_three_tier")
  }
}
