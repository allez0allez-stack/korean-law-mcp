/**
 * Scenario: delegation — 위임입법 미이행 감시기
 * 호스트 체인: chain_law_system
 *
 * 추가 조회: 법체계(행정규칙 포함) + 조문 이력
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool, pushResultSection } from "./types.js"
import { getLawSystemTree } from "../law-system-tree.js"
import { getArticleHistory } from "../article-history.js"

/**
 * 위임법령 연계(lnkDep) 조회는 뺐다 (2026-09-23 리뷰 B#9).
 * 이 목록 API 는 query 를 무시하고 전체 목록(실측 109,918건)을 돌려줘, 1페이지 100건 안에서만
 * 법령명을 거를 수 있다. 실측 '관세법' 매칭 0건: "위임입법 현황" 섹션은 사실상 실리지 못한 채
 * 업스트림 1회만 썼고, 빠진 사실도 알리지 않았다. 대신 무엇을 보라는지 밝힌다.
 */
const DELEGATION_STATUS_NOTE =
  "자동 대조 미제공: 법제처 위임 연계 목록이 법령명 검색 필터를 지원하지 않아 미제정 하위법령을 자동으로 집계하지 못합니다. " +
  "법제처 3단비교에서 [본문 인용 확인]은 하위 조문에 모법 조문이 명시됐다는 뜻이고, [연계 목록 확인]은 목록 등재만 확인됐다는 뜻입니다. " +
  "법체계도에 표시되는 시행령·시행규칙·고시는 법령 단위 관련 목록이므로 각 조문에 직접 위임됐다고 단정할 수 없습니다. " +
  "위임의 적법성·범위 또는 미제정 하위규정의 부재는 자동 검증하지 않습니다. LLM은 미이행 위임이 없다고 단정하지 마세요."

export async function runDelegationScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  if (!ctx.law) {
    return { sections, suggestedActions }
  }

  const { lawName, lawId, mst } = ctx.law

  // 명시적으로 지정한 조문만 조회한다. 법률 전체를 조회하면 2007년 제정 당시
  // 제1조~수백 조 이력이 뒤에 붙고, 응답 길이 제한으로 정작 위임 관계가 밀려난다.
  const requestedArticles = [...new Set((ctx.articles ?? []).map(a => a.trim()).filter(Boolean))].slice(0, 5)

  // 법체계 트리는 항상 조회하되, 개정 이력은 명시적 조문에 대해서만 조회한다.
  // 조문 미지정 시 전체 법률 이력을 암묵적으로 쓸어오지 않는다.
  const [treeR, histories] = await Promise.all([
    callTool(getLawSystemTree, ctx.apiClient, { mst, apiKey: ctx.apiKey }),
    lawId && requestedArticles.length
      ? Promise.all(requestedArticles.map(jo => callTool(getArticleHistory, ctx.apiClient, {
          lawId, jo, apiKey: ctx.apiKey,
        })))
      : Promise.resolve([]),
  ])

  sections.push({ title: "위임입법 현황 (미제정 포함)", content: DELEGATION_STATUS_NOTE })
  pushResultSection(sections, "법체계 + 행정규칙", treeR)
  if (!requestedArticles.length) {
    sections.push({
      title: "위임 조문 개정이력",
      content: "조문 미지정으로 전체 개정이력 수집을 생략했습니다. 특정 조문이 필요하면 articles:[\"제XX조\"]를 지정하세요.",
    })
  } else {
    for (let i = 0; i < histories.length; i++) {
      pushResultSection(sections, `${requestedArticles[i]} 개정이력 (위임 조항 변동 추적)`, histories[i])
    }
    if ((ctx.articles ?? []).filter(a => a.trim()).length > requestedArticles.length) {
      sections.push({
        title: "개정이력 조회 범위 제한",
        content: "요청된 조문 중 중복을 제거하고 최대 5개 조문만 조회했습니다. 나머지는 별도 요청하세요.",
      })
    }
  }

  // 후속 액션
  suggestedActions.push(
    `${lawName} 시행령 체계`,
    `${lawName} 개정이력`,
    `${lawName} 연계 자치법규`,
  )

  return { sections, suggestedActions }
}
