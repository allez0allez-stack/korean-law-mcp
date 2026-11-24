import { describe, expect, it } from "vitest"
import { parseKofiaLatestIpoVersion as parse, latestRevisionDateInRule as date } from "./kofia-version-resolver.js"
const name = "증권 인수업무 등에 관한 규정"
const row = (id: string, d: string, title = name) =>
  '<tr><td>1449</td><td><a href="revisionView.do?historySeq=' + id + '">' + title + '</a></td><td>개정</td><td>' + d + '</td></tr>'
const list = (...rows: string[]) => '<table>' + rows.join('') + '</table>'

describe("KOFIA revision identity safety", () => {
  it("accepts the verified index shape", () => expect(parse(list(row("1820","2026-11-12")))?.historySeq).toBe("1820"))
  it("chooses the newer dated revision", () => expect(parse(list(row("1820","2026-11-12"),row("1902","2027-01-05")))?.historySeq).toBe("1902"))
  it("fails closed rather than silently selecting an older revision", () => {
    expect(parse(list(row("1820","2026-11-12"),'<tr><td>'+name+'</td><td>2027-01-05</td></tr>'))).toBeNull()
  })
  it("rejects unrelated titles", () => expect(parse(list(row("1820","2026-11-12"),row("1902","2027-01-05",name+" 시행세칙")))?.historySeq).toBe("1820"))
  it("rejects impossible calendar dates", () => expect(parse(list(row("1820","2026-02-30")))).toBeNull())
  it("rejects same-day different ids", () => expect(parse(list(row("1820","2026-11-12"),row("1821","2026-11-12")))).toBeNull())
  it("allows identical duplicate rows", () => expect(parse(list(row("1820","2026-11-12"),row("1820","2026-11-12")))?.historySeq).toBe("1820"))
  it("rejects contradictory dates for one id", () => expect(parse(list(row("1820","2026-11-12"),row("1820","2026-11-13")))).toBeNull())
  it("rejects multiple dates without proven column identity", () => expect(parse(list('<tr><td>2027-01-05</td><td><a href="revisionView.do?historySeq=1820">'+name+'</a></td><td>2026-11-12</td></tr>'))).toBeNull())
  it("does not borrow a revision id from an unrelated cell", () => expect(parse(list('<tr><td>'+name+'</td><td><a href="revisionView.do?historySeq=1820">다운로드</a></td><td>2026-11-12</td></tr>'))).toBeNull())
  it("rejects conflicting ids in the title cell", () => expect(parse(list('<tr><td><a href="revisionView.do?historySeq=1820" onclick="goRevision(1821)">'+name+'</a></td><td>2026-11-12</td></tr>'))).toBeNull())
  it("excludes later dates from the operative body", () => expect(date("개정 2026. 11. 12 제1장 총칙 개정 2027. 1. 1")).toBe("2026-11-12"))
  it("rejects invalid preamble dates", () => expect(date("개정 2026. 2. 30 제1장 총칙")).toBeNull())
})
