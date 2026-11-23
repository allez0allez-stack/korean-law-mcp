/** Financial Services Commission rule follow-up for IPO cornerstone topics.
 * Search the current official administrative rule ID, never hardcode a serial
 * which changes on each amendment. Verify exact title before reading.
 */
import type { LawApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"
import { searchAdminRule, getAdminRule } from "./admin-rule.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { truncateResponse } from "../lib/schemas.js"

const RULE = "증권의 발행 및 공시 등에 관한 규정"
const ARTICLES = ["제2-12조의2", "제2-12조의3", "제2-12조의4"] as const

export function parseExactFscRuleId(text: string): string | undefined {
  // Do not pick the similarly named '시행세칙' or a substring search hit.
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp(`^\\s*\\d+\\.\\s+${RULE}\\s*$`).test(lines[i])) continue
    const lookahead = lines.slice(i + 1, i + 6).join("\n")
    const id = /행정규칙일련번호:\s*(\d{9,16})/.exec(lookahead)?.[1]
    if (id) return id
  }
  return undefined
}

interface RuleDeps {
  search?: typeof searchAdminRule
  read?: typeof getAdminRule
}

export async function getFscIpoRuleEvidence(
  apiClient: LawApiClient,
  input: { apiKey?: string },
  deps: RuleDeps = {},
): Promise<ToolResponse> {
  const search = deps.search ?? searchAdminRule
  const read = deps.read ?? getAdminRule
  try {
    const found = await search(apiClient, {query:RULE, display:10, apiKey:input.apiKey})
    if (found.isError) throw Error("금융위 현행 고시 검색 실패")
    const id = parseExactFscRuleId(found.content[0]?.text || "")
    if (!id) throw Error("금융위 고시 정확 법규명/현행 일련번호 식별 실패")
    const body: string[] = [
      `[OFFICIAL_ADMINISTRATIVE_RULE] 금융위원회 「${RULE}」`,
      `법제처 행정규칙 현행 검색 결과 일련번호: ${id}`,
      "※ 금융위 고시이며 법률·대통령령이나 금투협 자율규정이 아닙니다.",
    ]
    for (const jo of ARTICLES) {
      const result = await read(apiClient, {id, jo, apiKey:input.apiKey})
      const text = result.content[0]?.text || ""
      if (result.isError || !text.includes(`제2-12조의${jo.split('의')[1]}`) || !text.includes(`행정규칙명: ${RULE}`)) {
        body.push(`${jo} [NOT_VERIFIED] 정확 조문 확인 실패 — 추측하지 않습니다.`)
      } else {
        body.push(`▶ ${jo} 공식 원문\n${text.slice(0, 2700)}`)
      }
    }
    return {content:[{type:"text",text:truncateResponse(body.join("\n\n"))}]}
  } catch(error) {
    rethrowIfFatal(error)
    return {content:[{type:"text",text:`[NOT_VERIFIED] 금융위 「${RULE}」의 현행 일련번호 또는 원문 조회 실패: ${error instanceof Error ? error.message.slice(0,160):String(error)}. 법제처 search_admin_rule로 재확인하십시오. 추측 금지.`}],isError:true}
  }
}
