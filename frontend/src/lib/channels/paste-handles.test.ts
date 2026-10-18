import { describe, expect, it } from "bun:test"

import { parsePastedHandles } from "./paste-handles"

const statuses = (text: string, known: string[] = []) =>
  parsePastedHandles(text, known).map((p) => `${p.handle}:${p.status}`)

describe("parsePastedHandles", () => {
  it("reads @handle, t.me/handle and t.me/s/handle alike", () => {
    expect(statuses("@durov https://t.me/telegram t.me/s/bbcpersian")).toEqual([
      "durov:new",
      "telegram:new",
      "bbcpersian:new",
    ])
  })

  it("splits on lines, spaces and commas", () => {
    expect(statuses("durov,telegram\n  bbcpersian ,, \n")).toEqual([
      "durov:new",
      "telegram:new",
      "bbcpersian:new",
    ])
  })

  it("collapses duplicates, whatever their case or form", () => {
    expect(statuses("@Durov t.me/durov durov")).toEqual(["Durov:new"])
  })

  it("marks a handle already known, case-insensitively", () => {
    expect(statuses("DUROV telegram", ["Durov"])).toEqual([
      "DUROV:known",
      "telegram:new",
    ])
  })

  it("applies the server's rule: a leading letter, then 5 to 32 in all", () => {
    expect(
      statuses(
        `abcd abcde ${"a".repeat(32)} ${"a".repeat(33)} 1digit _under bad-name ok_name_1`,
      ),
    ).toEqual([
      "abcd:invalid",
      "abcde:new",
      `${"a".repeat(32)}:new`,
      `${"a".repeat(33)}:invalid`,
      "1digit:invalid",
      "_under:invalid",
      "bad-name:invalid",
      "ok_name_1:new",
    ])
  })

  it("has nothing to say about an empty paste", () => {
    expect(parsePastedHandles("  \n , ", [])).toEqual([])
  })
})
