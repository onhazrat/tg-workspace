import { expect, test } from "bun:test"
import { OPENING, parseDirectory, printDirectory } from "./directory-filter"

test("the text form reads back what it prints", () => {
  for (const src of [
    OPENING,
    "(lang:fa or lang:en) and subscribers >= 1000 and reach = none",
    'not (citedby:"durov telegram" or mine:14d) and parents:"selection 3"',
    'children:"a b" and last_post_days 1..7 and name:"news"',
  ]) {
    const t = parseDirectory(src)
    expect(t).not.toBeNull()
    expect(printDirectory(parseDirectory(printDirectory(t!))!)).toBe(
      printDirectory(t!),
    )
  }
  const p = parseDirectory('parents:"selection 3"')!
  expect(p.children[0]).toMatchObject({
    cond: { type: "parents", source: "selection", min: 3 },
  })
  expect(parseDirectory("is:bogus")).toBeNull()
})
