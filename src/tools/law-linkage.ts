/**
 * 법령-자치법규 연계(Linkage) 도구 4종
 * - get_linked_ordinances: 자치법규와 연계된 법령 식별 목록
 * - get_linked_ordinance_articles: 법령-자치법규 조문 연계
 * - get_delegated_laws: 위임 연계 자치법규 (조회 페이지 안에서 필터)
 * - get_linked_laws_from_ordinance: 법령과 연계된 자치법규 식별 목록
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { extractTag } from "../lib/xml-parser.js"
import { formatToolError } from "../lib/errors.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"

// === 스키마 ===

const baseLinkageSchema = z.object({
  query: z.string().describe("검색 키워드"),
  display: z.number().min(1).max(100).default(20).describe("결과 개수 (기본:20, 최대:100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본:1)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC)")
})

export const LinkedOrdinancesSchema = baseLinkageSchema.extend({
  query: z.string().describe("법령명 (예: '국민건강보험법')")
})
export const LinkedOrdinanceArticlesSchema = baseLinkageSchema.extend({
  query: z.string().describe("법령명 (예: '국민건강보험법')")
})
export const DelegatedLawsSchema = baseLinkageSchema.extend({
  officialLinkProbe: z.object({ mst: z.string().regex(/^\d{1,12}$/).optional(), lawId: z.string().regex(/^\d{1,12}$/).optional() }).refine(p => Boolean(p.mst) !== Boolean(p.lawId), "mst 또는 lawId 중 하나만 필요합니다").optional().describe("공식 lsDelegated 응답 구조 진단. 법적 관계를 확정하지 않음"),
  // 실측: lnkDep은 서버측 검색 필터가 없다(query 무시, 전체 덤프+페이징만).
  // 조회 페이지 내 클라이언트 필터만 가능 — 법령 기준 연계는 get_linked_ordinance_articles 권장.
  query: z.string().describe("필터 키워드(법령명 등) — ⚠️ 법제처가 이 목록의 서버측 검색을 지원하지 않아 조회 페이지 내 부분 필터만 됩니다. 법령 기준 자치법규 연계는 get_linked_ordinance_articles 사용 권장")
})
export const LinkedLawsFromOrdinanceSchema = baseLinkageSchema.extend({
  query: z.string().describe("자치법규명 (예: '서울특별시 주차장 설치 및 관리 조례')")
})

// === 범용 XML 파서 (응답 구조 미확정 대응) ===

function parseLinkageXML(xml: string, rootTag: string, itemTag: string) {
  // 루트 태그는 대소문자 무시로 매칭 — 실측상 lnkDepSearch·lnkOrdJoSearch처럼
  // 소문자로 시작해, 대문자 시작을 가정한 종전 코드는 3/4 타깃에서 루트 매칭에
  // 실패해 매 호출 0건(NOT_FOUND)이었다.
  const rootRegex = new RegExp(`<${rootTag}[^>]*>([\\s\\S]*?)<\\/${rootTag}>`, "i")
  const rootMatch = xml.match(rootRegex)
  if (!rootMatch) return { totalCnt: 0, page: 1, items: [] as Record<string, string>[] }

  const content = rootMatch[1]
  const totalCnt = parseInt(extractTag(content, "totalCnt") || "0", 10)
  const page = parseInt(extractTag(content, "page") || "1", 10)

  const itemRegex = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, "g")
  const items: Record<string, string>[] = []
  let match
  while ((match = itemRegex.exec(content)) !== null) {
    const fields: Record<string, string> = {}
    // 일반 태그
    const fieldRe = /<([^/>\s]+)>([^<]*)<\/\1>/g
    let fm
    while ((fm = fieldRe.exec(match[1])) !== null) fields[fm[1]] = fm[2].trim()
    // CDATA
    const cdataRe = /<([^/>\s]+)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/g
    while ((fm = cdataRe.exec(match[1])) !== null) fields[fm[1]] = fm[2].trim()
    if (Object.keys(fields).length > 0) items.push(fields)
  }
  return { totalCnt, page, items }
}

function formatItems(items: Record<string, string>[]): string {
  return items.map((item, i) => {
    const lines = Object.entries(item).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`)
    return `${i + 1}. ${lines.join('\n')}`
  }).join('\n\n')
}

// === 공통 핸들러 ===

interface LinkageConfig {
  target: string
  primaryRoot: string
  fallbackRoot: string
  title: string
  emptyMsg: string
  scopeNote?: string
  /** 서버가 query 필터를 지원하지 않는 전체 덤프 타깃 (실측: lnkDep 총 10만+건, query 무시) */
  serverFilterless?: boolean
}

type LinkageInput = z.infer<typeof baseLinkageSchema>

async function handleLinkage(apiClient: LawApiClient, input: LinkageInput, cfg: LinkageConfig) {
  try {
    const xml = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: cfg.target,
      extraParams: {
        query: String(input.query),
        // 필터 미지원 타깃은 클라이언트 필터 풀을 최대로 (API 상한 100)
        display: cfg.serverFilterless ? "100" : String(input.display || 20),
        page: String(input.page || 1),
      },
      apiKey: input.apiKey,
    })

    let result = parseLinkageXML(xml, cfg.primaryRoot, "law")
    if (result.totalCnt === 0 && result.items.length === 0) {
      result = parseLinkageXML(xml, cfg.fallbackRoot, "law")
    }

    if (result.items.length === 0) {
      return {
        content: [{ type: "text", text: truncateResponse(`[NOT_FOUND] '${input.query}' ${cfg.emptyMsg}\n⚠️ LLM은 연계 정보를 추측/생성하지 마세요.`) }],
        isError: true
      }
    }

    if (cfg.serverFilterless) {
      // 서버가 query를 무시하고 전체 목록을 돌려주는 타깃 — 조회분을 그대로 내보내면
      // 무관한 행들이 "검색 결과"로 위장된다. 조회 페이지 내 클라이언트 필터 + 한계 명시.
      const qKey = String(input.query).replace(/\s+/g, "")
      const fetched = result.items.length
      const matched = qKey
        ? result.items.filter(it => Object.values(it).some(v => v.replace(/\s+/g, "").includes(qKey)))
        : result.items

      const scopeNote = `⚠️ 법제처가 이 목록(서버 전체 ${result.totalCnt}건)의 검색 필터를 지원하지 않아, 조회한 ${result.page}페이지(${fetched}건) 안에서만 '${input.query}'를 필터했습니다 — 전수 결과가 아닙니다.\n` +
        `💡 법령 기준 자치법규 연계는 서버 필터가 지원되는 execute_tool(tool_name="get_linked_ordinance_articles", params={query:"법령명"})를 사용하세요.`

      if (matched.length === 0) {
        return {
          content: [{ type: "text", text: truncateResponse(`[NOT_FOUND] 조회한 ${result.page}페이지(${fetched}건) 내 '${input.query}' 매칭 없음.\n${scopeNote}`) }],
          isError: true
        }
      }
      let output = `${cfg.title} (조회 ${result.page}페이지 ${fetched}건 중 '${input.query}' 매칭 ${matched.length}건)\n\n`
      output += formatItems(matched)
      output += `\n\n${scopeNote}`
      return { content: [{ type: "text", text: truncateResponse(output) }] }
    }

    let output = `${cfg.title} (총 ${result.totalCnt}건, ${result.page}페이지)\n`
    output += `검색어: ${input.query}\n`
    if (cfg.scopeNote) output += `${cfg.scopeNote}\n`
    output += "\n"
    output += formatItems(result.items)
    return { content: [{ type: "text", text: truncateResponse(output) }] }
  } catch (error) {
    return formatToolError(error, cfg.title)
  }
}

// === 도구 함수 ===

export const getLinkedOrdinances = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    target: "lnkLs", primaryRoot: "LawSearch", fallbackRoot: "LnkLsSearch",
    title: "자치법규와 연계된 법령 목록", emptyMsg: "연계 법령 목록이 없습니다.",
    scopeNote: "ℹ️ 이 목록은 연계된 법령의 식별정보입니다. 조례명·조문 대응은 execute_tool(tool_name=\"get_linked_ordinance_articles\", params={query:\"법령명\"})로 확인하세요."
  })

export const getLinkedOrdinanceArticles = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    // 실측 루트는 lnkOrdJoSearch (LnkLsOrdJoSearch 아님 — 이름 자체가 달랐다)
    target: "lnkLsOrdJo", primaryRoot: "lnkOrdJoSearch", fallbackRoot: "LawSearch",
    title: "법령-자치법규 조문 연계", emptyMsg: "조문 연계 결과가 없습니다."
  })

/** Bounded, explicit, read-only upstream schema probe. No raw response or credentials. */
async function probeOfficialLinks(api: LawApiClient, input: z.infer<typeof DelegatedLawsSchema>) {
  const probe = input.officialLinkProbe!
  const failure = (msg: string) => ({content:[{type:"text",text:"[PROBE_NOT_VERIFIED] "+msg}],isError:true})
  if (Boolean(probe.mst) === Boolean(probe.lawId) || !/^\d{1,12}$/.test(probe.mst || probe.lawId || "")) return failure("정확한 MST 또는 법령ID 하나가 필요합니다.")
  try {
    const raw = await api.fetchApi({endpoint:"lawService.do",target:"lsDelegated",type:"JSON",extraParams:probe.mst?{MST:probe.mst}:{ID:probe.lawId!},apiKey:input.apiKey})
    if (raw.length > 5_000_000) return failure("응답 크기 한도 초과")
    const payload: unknown = JSON.parse(raw)
    const allowed = new Set(["법령일련번호","법령명","법령ID","시행일자","조문번호","조문가지번호","조문제목","위임구분","위임법령일련번호","위임법령제목","위임법령조문번호","위임법령조문가지번호","위임행정규칙일련번호","위임행정규칙제목","조항호목"])
    const stack: Array<{node:unknown,path:string,depth:number,article:string}> = [{node:payload,path:"$",depth:0,article:""}]
    const shapes = new Set<string>(), identities: Array<Record<string,string>> = [], samples: Array<Record<string,string>> = []
    let visited=0, links=0, metadata=0, clipped=false
    while (stack.length) {
      const {node,path,depth,article}=stack.pop()!
      if (++visited>50000 || depth>24) {clipped=true;break}
      if (!node || typeof node!=="object") continue
      if (Array.isArray(node)) { for (const n of node) stack.push({node:n,path:path+"[]",depth:depth+1,article});continue }
      const row=Object.fromEntries(Object.entries(node))
      const scalar=(v:unknown)=>typeof v==="string"?v.slice(0,200):typeof v==="number"&&Number.isSafeInteger(v)?String(v):""
      const current=scalar(row["조문번호"])||article
      const keys=Object.keys(row).filter(k=>/^[가-힣A-Za-z0-9_]{1,80}$/.test(k)).sort()
      if(shapes.size<40)shapes.add(path+": "+keys.slice(0,35).join(", "))
      const identity=Boolean(row["법령명"]&&row["법령일련번호"]&&row["시행일자"])
      const admin=Boolean(row["위임행정규칙일련번호"]||row["위임행정규칙제목"])
      if(identity)metadata++
      if(admin)links++
      if((identity&&identities.length<3)||(admin&&samples.length<9)){
        const sample:Record<string,string>={path,sourceArticle:current}
        for(const k of keys)if(allowed.has(k)&&scalar(row[k]))sample[k]=scalar(row[k])
        if(identity&&identities.length<3)identities.push(sample)
        if(admin&&samples.length<9)samples.push(sample)
      }
      for(const k of keys)if(row[k]&&typeof row[k]==="object")stack.push({node:row[k],path:path+"."+k,depth:depth+1,article:current})
    }
    if(!metadata)return failure("JSON 응답에서 공식 법령 식별정보 미확인; 링크 부존재를 의미하지 않습니다. 구조: "+[...shapes].slice(0,10).join(" | ").slice(0,1500))
    return {content:[{type:"text",text:truncateResponse("[PROBE_RESPONSE] 공식 API 구조 진단 — 법적 근거 검증 아님\n"+JSON.stringify({metadata,links,clipped,shapes:[...shapes],identities,samples},null,2),14000)}]}
  }catch(e){rethrowIfFatal(e);return failure("공식 위임법령 API 요청 또는 JSON 해석 실패")}
}

export const getDelegatedLaws = (apiClient: LawApiClient, input: z.infer<typeof DelegatedLawsSchema>) =>
  input.officialLinkProbe ? probeOfficialLinks(apiClient,input) : handleLinkage(apiClient, input, {
    // 실측 루트는 lnkDepSearch — 종전 대문자 가정(LnkDepSearch)으로 매 호출 0건이었다
    target: "lnkDep", primaryRoot: "lnkDepSearch", fallbackRoot: "LawSearch",
    title: "위임 연계 자치법규 목록", emptyMsg: "위임 연계 자치법규가 없습니다.",
    serverFilterless: true
  })

export const getLinkedLawsFromOrdinance = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    // 실측 루트는 OrdinSearch (LnkOrdSearch 아님)
    target: "lnkOrd", primaryRoot: "OrdinSearch", fallbackRoot: "LawSearch",
    title: "법령과 연계된 자치법규 목록", emptyMsg: "연계 자치법규 목록이 없습니다.",
    scopeNote: "ℹ️ 이 목록은 연계된 자치법규의 식별정보입니다. 근거 법령은 execute_tool(tool_name=\"get_ordinance\", params={ordinSeq:\"자치법규일련번호\"}) 본문에서 확인하세요."
  })
