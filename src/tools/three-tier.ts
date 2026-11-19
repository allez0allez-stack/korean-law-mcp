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
  const re = /(?:^|[^가-힣A-Za-z0-9])법\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?!\s*\d)/g
  for (const match of targetContent.matchAll(re)) {
    const citedArticle = Number(match[1])
    const citedBranch = match[2] === undefined ? undefined : Number(match[2])
    if (citedArticle === article && citedBranch === branch) return "explicit_citation"
  }
  return "listed_only"
}

export const GetThreeTierSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  jo: z.string().regex(/^제\s*\d+\s*조(?:의\s*\d+)?$/).optional().describe("특정 법률 조문으로 위임관계 한정 (예: 제249조의7)"),
  knd: z.enum(["1", "2"]).optional().default("2").describe("1=인용조문, 2=위임조문 (기본값)"),
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
    const cacheKey = `thdcmp:${input.mst ? `m${input.mst}` : `i${input.lawId}`}:${input.knd || "2"}:${input.jo?.replace(/\s+/g, "") || "all"}`
    const cached = lawCache.get<string>(cacheKey)
    if (cached) return { content: [{ type: "text", text: cached }] }

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

    const text = truncateResponse(resultText)
    lawCache.set(cacheKey, text, 60 * 60 * 1000)
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return formatToolError(error, "get_three_tier")
  }
}
