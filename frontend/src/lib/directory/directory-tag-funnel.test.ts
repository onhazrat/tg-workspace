/**
 * The Directory Tags dropdown's funnel (TGU-03): a funnelled Tag is a `tag:`
 * Condition on the top-level AND, two or more one OR group, so two funnelled
 * Tags mean either one; the rest of the filter is left alone.
 */
import { describe, expect, test } from "bun:test"
import { parseDirectoryFilter, printDirectoryFilter } from "./directory-filter"
import {
  clearTagFunnels,
  funnelledTags,
  toggleTagFunnel,
} from "./directory-tag-funnel"

const parse = (text: string) => {
  const filter = parseDirectoryFilter(text)
  if (!filter) throw new Error(`no filter in ${text}`)
  return filter
}

describe("the Directory's Tag funnel", () => {
  test("one Tag joins the top-level AND; a second makes them either one", () => {
    const one = toggleTagFunnel(parse("lang:fa"), "News", true)
    expect(printDirectoryFilter(one)).toBe("lang:fa and tag:News")
    const two = toggleTagFunnel(one, "Tech", true)
    expect(printDirectoryFilter(two)).toBe("lang:fa and (tag:News or tag:Tech)")
    expect(funnelledTags(two)).toEqual(["News", "Tech"])
    const three = toggleTagFunnel(two, "Art", true)
    expect(funnelledTags(three)).toEqual(["News", "Tech", "Art"])
  })

  test("a funnelled Tag, in any case, is not added twice", () => {
    const one = toggleTagFunnel(parse("lang:fa"), "News", true)
    expect(toggleTagFunnel(one, "news", true)).toBe(one)
  })

  test("unfunnelling takes the Tag out and unwraps a group of one", () => {
    const two = toggleTagFunnel(
      toggleTagFunnel(parse("lang:fa"), "News", true),
      "Tech",
      true,
    )
    const back = toggleTagFunnel(two, "news", false)
    expect(printDirectoryFilter(back)).toBe("lang:fa and tag:Tech")
    expect(printDirectoryFilter(clearTagFunnels(two))).toBe("lang:fa")
  })

  test("a Tag inside the Filters' own parentheses is not a funnel", () => {
    const filter = parse("lang:fa and not tag:News")
    expect(funnelledTags(filter)).toEqual([])
    expect(clearTagFunnels(filter)).toBe(filter)
  })

  test("an OR filter is wrapped before a funnel joins it with AND", () => {
    const or = parse("lang:fa or lang:en")
    expect(funnelledTags(or)).toEqual([])
    expect(printDirectoryFilter(toggleTagFunnel(or, "News", true))).toBe(
      "(lang:fa or lang:en) and tag:News",
    )
  })
})
