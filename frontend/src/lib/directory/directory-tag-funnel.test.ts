/**
 * The Directory Tags dropdown's funnel (TGU-03): a funnelled Tag is a `tag:`
 * Condition on the top-level AND, two or more one OR group, so two funnelled
 * Tags mean either one; the rest of the filter is left alone.
 */
import { describe, expect, test } from "bun:test"
import { parseDirectoryFilter, printDirectoryFilter } from "./directory-filter"
import {
  clearNamedFunnels,
  funnelledNames,
  toggleNamedFunnel,
} from "./directory-tag-funnel"

const parse = (text: string) => {
  const filter = parseDirectoryFilter(text)
  if (!filter) throw new Error(`no filter in ${text}`)
  return filter
}

describe("the Directory's Tag funnel", () => {
  test("one Tag joins the top-level AND; a second makes them either one", () => {
    const one = toggleNamedFunnel(parse("lang:fa"), "News", true, "tag")
    expect(printDirectoryFilter(one)).toBe("lang:fa and tag:News")
    const two = toggleNamedFunnel(one, "Tech", true, "tag")
    expect(printDirectoryFilter(two)).toBe("lang:fa and (tag:News or tag:Tech)")
    expect(funnelledNames(two, "tag")).toEqual(["News", "Tech"])
    const three = toggleNamedFunnel(two, "Art", true, "tag")
    expect(funnelledNames(three, "tag")).toEqual(["News", "Tech", "Art"])
  })

  test("a funnelled Tag, in any case, is not added twice", () => {
    const one = toggleNamedFunnel(parse("lang:fa"), "News", true, "tag")
    expect(toggleNamedFunnel(one, "news", true, "tag")).toBe(one)
  })

  test("unfunnelling takes the Tag out and unwraps a group of one", () => {
    const two = toggleNamedFunnel(
      toggleNamedFunnel(parse("lang:fa"), "News", true, "tag"),
      "Tech",
      true,
      "tag",
    )
    const back = toggleNamedFunnel(two, "news", false, "tag")
    expect(printDirectoryFilter(back)).toBe("lang:fa and tag:Tech")
    expect(printDirectoryFilter(clearNamedFunnels(two, "tag"))).toBe("lang:fa")
  })

  test("a Tag inside the Filters' own parentheses is not a funnel", () => {
    const filter = parse("lang:fa and not tag:News")
    expect(funnelledNames(filter, "tag")).toEqual([])
    expect(clearNamedFunnels(filter, "tag")).toBe(filter)
  })

  test("a Setting group funnel is its own OR group beside the Tags' (TGU-04)", () => {
    const tags = toggleNamedFunnel(
      toggleNamedFunnel(parse("lang:fa"), "News", true, "tag"),
      "Tech",
      true,
      "tag",
    )
    const one = toggleNamedFunnel(tags, "Slow", true, "group")
    const two = toggleNamedFunnel(one, "Fast", true, "group")
    expect(printDirectoryFilter(two)).toBe(
      "lang:fa and (tag:News or tag:Tech) and (group:Slow or group:Fast)",
    )
    expect(funnelledNames(two, "group")).toEqual(["Slow", "Fast"])
    expect(funnelledNames(two, "tag")).toEqual(["News", "Tech"])
    expect(printDirectoryFilter(clearNamedFunnels(two, "group"))).toBe(
      "lang:fa and (tag:News or tag:Tech)",
    )
    expect(
      printDirectoryFilter(toggleNamedFunnel(two, "slow", false, "group")),
    ).toBe("lang:fa and (tag:News or tag:Tech) and group:Fast")
  })

  test("an OR filter is wrapped before a funnel joins it with AND", () => {
    const or = parse("lang:fa or lang:en")
    expect(funnelledNames(or, "tag")).toEqual([])
    expect(
      printDirectoryFilter(toggleNamedFunnel(or, "News", true, "tag")),
    ).toBe("(lang:fa or lang:en) and tag:News")
  })
})
