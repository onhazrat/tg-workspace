/**
 * The Directory view in the URL (DIR-02): the filter as one parameter in its
 * text form, the rest beside it, so a shared link opens exactly that view.
 * A parameter the server would refuse falls back to its default rather than
 * failing every read.
 */
import { describe, expect, test } from "bun:test"
import { OPENING_FILTER } from "./directory-filter"
import {
  chooseSort,
  DEFAULT_VIEW,
  hasViewParams,
  headerSort,
  paramsFromView,
  resolveYours,
  SORT_OPTIONS,
  sortValue,
  viewFromParams,
} from "./directory-view"

describe("the view and its URL parameters", () => {
  test("no parameters is the opening view, sorted by Cited by your channels", () => {
    expect(viewFromParams({})).toEqual({
      filter: OPENING_FILTER,
      sort: "mine",
      descending: true,
      kinds: [],
      page: 0,
    })
    expect(DEFAULT_VIEW.filter).toBe(OPENING_FILTER)
  })

  test("every field reads back from the parameters it wrote", () => {
    const view = {
      filter: "lang:fa and subscribers >= 1000",
      sort: "last_post_days" as const,
      descending: false,
      yours: "ticked" as const,
      kinds: ["forward" as const, "link" as const],
      page: 3,
    }
    expect(viewFromParams(paramsFromView(view))).toEqual(view)
  })

  test("the filter is always written, so a copied link never adopts another view", () => {
    expect(paramsFromView(DEFAULT_VIEW)).toEqual({ dirFilter: OPENING_FILTER })
    expect(paramsFromView({ ...DEFAULT_VIEW, filter: "" })).toEqual({
      dirFilter: "",
    })
    expect(viewFromParams({ dirFilter: "" }).filter).toBe("")
  })

  test("a direction is written only when it is not the sort's default", () => {
    expect(
      paramsFromView({
        ...DEFAULT_VIEW,
        sort: "found_days",
        descending: false,
      }),
    ).toEqual({ dirFilter: OPENING_FILTER, dirSort: "found_days" })
    expect(
      paramsFromView({ ...DEFAULT_VIEW, descending: false }).dirOrder,
    ).toBe("asc")
  })

  test("a value the server would refuse falls back", () => {
    expect(
      viewFromParams({
        dirSort: "handle",
        dirOrder: "sideways",
        dirYours: "everyone",
        dirKinds: "forward,quote,forward",
        dirPage: "-2",
      }),
    ).toEqual({ ...DEFAULT_VIEW, kinds: ["forward"] })
    expect(viewFromParams({ dirPage: "10001" }).page).toBe(0)
  })

  test("only a dir parameter makes a view; the other tabs' do not", () => {
    expect(hasViewParams({})).toBe(false)
    expect(hasViewParams({ postFilter: "lang:fa" })).toBe(false)
    expect(hasViewParams({ dirFilter: "" })).toBe(true)
    expect(hasViewParams({ dirPage: "2" })).toBe(true)
  })
})

describe("whose citations count", () => {
  const sources = { selection: ["b", "a"], ticked: ["t"] }

  test("with no stored value, the selection when there is one, else every follow", () => {
    expect(resolveYours(undefined, sources)).toEqual({
      source: "selection",
      handles: ["b", "a"],
    })
    expect(resolveYours(undefined, { selection: [], ticked: [] })).toEqual({
      source: "follows",
      handles: [],
    })
  })

  test("a value chosen explicitly is never swapped, even when empty", () => {
    expect(resolveYours("ticked", { selection: ["a"], ticked: [] })).toEqual({
      source: "ticked",
      handles: [],
    })
    expect(resolveYours("follows", sources)).toEqual({
      source: "follows",
      handles: [],
    })
  })
})

describe("the sort picker", () => {
  test("offers Cited by your channels once per source, then every measure", () => {
    const labels = SORT_OPTIONS.map((o) => o.label)
    expect(labels.slice(0, 3)).toEqual([
      "Cited by channels you follow",
      "Cited by your Channels tab selection",
      "Cited by channels ticked here",
    ])
    expect(labels).toContain("Days since your channels last cited it")
    expect(labels).toContain("Subscribers")
  })

  test("choosing a source sets the view's value and the default direction", () => {
    expect(chooseSort("mine:ticked")).toEqual({
      sort: "mine",
      yours: "ticked",
      descending: true,
      page: 0,
    })
    expect(chooseSort("last_post_days")).toEqual({
      sort: "last_post_days",
      descending: false,
      page: 0,
    })
    expect(chooseSort("mine_last_days").descending).toBe(false)
  })

  test("a header flips its own column and sorts by another, days newest first", () => {
    const view = { ...DEFAULT_VIEW, sort: "reach" as const }
    expect(headerSort(view, "reach", "follows")).toEqual({ descending: false })
    expect(headerSort(view, "found_days", "follows")).toEqual({
      sort: "found_days",
      descending: false,
      page: 0,
    })
    expect(headerSort(view, "mine", "selection")).toEqual({
      sort: "mine",
      yours: "selection",
      descending: true,
      page: 0,
    })
  })

  test("the picker's value names the source the view counts", () => {
    expect(sortValue({ ...DEFAULT_VIEW }, "selection")).toBe("mine:selection")
    expect(sortValue({ ...DEFAULT_VIEW, sort: "reach" }, "follows")).toBe(
      "reach",
    )
  })
})
