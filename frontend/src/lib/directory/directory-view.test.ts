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
  dismissalNotice,
  hasViewParams,
  headerSort,
  listSummary,
  paramsFromView,
  resolveYours,
  SORT_OPTIONS,
  searchPatch,
  searchRequest,
  sortOptions,
  sortValue,
  toggleField,
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
      search: "",
      fields: ["name", "bio", "posts"],
      matches: true,
    })
    expect(DEFAULT_VIEW.filter).toBe(OPENING_FILTER)
  })

  test("every field reads back from the parameters it wrote", () => {
    const view = {
      ...DEFAULT_VIEW,
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

describe("what the tab shows of a list read", () => {
  const data = {
    rows: [],
    total: 7,
    languages: [{ language: "fa", count: 7 }],
    yoursSize: 0,
    ms: 120,
  }

  test("nothing to count while the first page loads", () => {
    expect(listSummary(undefined, true, "follows")).toEqual({
      rows: [],
      total: undefined,
      languages: [],
      ms: undefined,
      emptyYours: undefined,
    })
  })

  test("the time only once nothing is in flight, and an empty source by name", () => {
    expect(listSummary(data, false, "ticked")).toMatchObject({
      total: 7,
      ms: 120,
      emptyYours: "ticked",
    })
    expect(listSummary(data, true, "ticked").ms).toBeUndefined()
    expect(
      listSummary({ ...data, yoursSize: 3 }, false, "ticked").emptyYours,
    ).toBeUndefined()
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

describe("the search (DIR-04)", () => {
  const previous = { sort: "reach" as const, descending: false }

  test("search, fields and Show matches read back from their parameters", () => {
    const view = {
      ...DEFAULT_VIEW,
      search: "новости",
      fields: ["name" as const, "posts" as const],
      matches: false,
      sort: "relevance" as const,
    }
    const params = paramsFromView(view)
    expect(params).toMatchObject({
      dirQ: "новости",
      dirIn: "name,posts",
      dirMatches: "off",
      dirSort: "relevance",
    })
    expect(viewFromParams(params)).toEqual(view)
  })

  test("no search is every field with matches shown, and writes nothing", () => {
    expect(viewFromParams({})).toMatchObject({
      search: "",
      fields: ["name", "bio", "posts"],
      matches: true,
    })
    expect(paramsFromView(DEFAULT_VIEW)).toEqual({ dirFilter: OPENING_FILTER })
  })

  test("an unknown field is dropped, and no known field is every field", () => {
    expect(viewFromParams({ dirIn: "bio,title" }).fields).toEqual(["bio"])
    expect(viewFromParams({ dirIn: "title" }).fields).toEqual([
      "name",
      "bio",
      "posts",
    ])
  })

  test("Relevance without a search falls back to the default sort", () => {
    expect(viewFromParams({ dirSort: "relevance" }).sort).toBe("mine")
    expect(viewFromParams({ dirSort: "relevance", dirQ: "  " }).sort).toBe(
      "mine",
    )
  })

  test("the request carries the trimmed search, or none for a blank box", () => {
    expect(searchRequest(DEFAULT_VIEW)).toBeNull()
    expect(searchRequest({ ...DEFAULT_VIEW, search: "   " })).toBeNull()
    expect(
      searchRequest({ ...DEFAULT_VIEW, search: " crypto ", fields: ["bio"] }),
    ).toEqual({ text: "crypto", fields: ["bio"] })
  })

  test("starting a search switches to Relevance, strongest first", () => {
    expect(searchPatch(DEFAULT_VIEW, "news", previous)).toEqual({
      search: "news",
      sort: "relevance",
      descending: true,
    })
  })

  test("editing a search keeps a sort chosen while searching", () => {
    const view = { ...DEFAULT_VIEW, search: "news", sort: "reach" as const }
    expect(searchPatch(view, "news fa", previous)).toEqual({
      search: "news fa",
    })
  })

  test("clearing the search returns Relevance to the sort before it", () => {
    const view = {
      ...DEFAULT_VIEW,
      search: "news",
      sort: "relevance" as const,
    }
    expect(searchPatch(view, "", previous)).toEqual({
      search: "",
      sort: "reach",
      descending: false,
    })
    expect(searchPatch(view, "  ", previous)).toMatchObject({ sort: "reach" })
  })

  test("the last field cannot be turned off", () => {
    expect(toggleField(["name", "bio", "posts"], "bio")).toEqual([
      "name",
      "posts",
    ])
    expect(toggleField(["bio"], "bio")).toEqual(["bio"])
    expect(toggleField(["posts"], "name")).toEqual(["name", "posts"])
  })

  test("the picker offers Relevance only while searching, first", () => {
    expect(sortOptions(false)).toBe(SORT_OPTIONS)
    expect(sortOptions(true)[0]).toEqual({
      value: "relevance",
      label: "Relevance",
    })
    expect(sortOptions(true).slice(1)).toEqual(SORT_OPTIONS)
  })

  test("a Shared relation's weighted sort is offered only while it is on (DIR-07)", () => {
    expect(sortOptions(false, ["children"]).at(-1)).toEqual({
      value: "shared_children",
      label: "Shared children (weighted)",
    })
    expect(
      sortOptions(true, ["parents", "children"]).map((o) => o.value),
    ).toContain("shared_parents")
    // A link sorting by one survives a reload.
    expect(viewFromParams({ dirSort: "shared_parents" }).sort).toBe(
      "shared_parents",
    )
  })
})

describe("the Dismissal's confirmation (DIR-06)", () => {
  test("names one Channel, counts several", () => {
    expect(dismissalNotice(["alpha"])).toBe("Dismissed @alpha")
    expect(dismissalNotice(["a", "b", "c"])).toBe("Dismissed 3 channels")
  })
})
