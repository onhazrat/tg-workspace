import { describe, expect, it } from "bun:test"

import { parsePastedHandles } from "./paste-handles"

const statuses = (text: string, followed: string[] = []) =>
  parsePastedHandles(text, followed).map((p) => `${p.handle}:${p.status}`)

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

  it("marks a handle already followed, case-insensitively", () => {
    expect(statuses("DUROV telegram", ["Durov"])).toEqual([
      "DUROV:following",
      "telegram:new",
    ])
  })

  it("marks anything outside 4 to 32 letters, digits or underscores", () => {
    expect(
      statuses(
        `abc abcd ${"a".repeat(32)} ${"a".repeat(33)} bad-name ok_name_1`,
      ),
    ).toEqual([
      "abc:invalid",
      "abcd:new",
      `${"a".repeat(32)}:new`,
      `${"a".repeat(33)}:invalid`,
      "bad-name:invalid",
      "ok_name_1:new",
    ])
  })

  it("has nothing to say about an empty paste", () => {
    expect(parsePastedHandles("  \n , ", [])).toEqual([])
  })
})
