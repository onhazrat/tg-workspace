/**
 * The Directory's bar (DIR-02), props-only: the switches edit the filter's
 * own Conditions and show off inside an OR, every dropdown opens on a search,
 * the Language funnel and the Filters picker add Conditions, and the footer
 * says when "your channels" is empty.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type {
  ColumnCatalogue,
  ColumnChoices,
} from "@/lib/directory/directory-columns"
import {
  type DirectoryFilter,
  OPENING_FILTER,
  parseDirectoryFilter,
  printDirectoryFilter,
} from "@/lib/directory/directory-filter"
import type { SearchField } from "@/lib/directory/directory-view"
import {
  CHANNELS_ONLY,
  type ColumnsMenu,
  ColumnsPill,
  DirectoryBar,
  type DirectoryBarProps,
  DirectorySearch,
} from "./DirectoryBar"
import { directoryVocabulary } from "./directory-vocabulary"

afterEach(cleanup)

const CATALOGUE: ColumnCatalogue = [
  { key: "language", default: true },
  { key: "subscribers", default: true },
  { key: "reach", default: true },
  { key: "photos", default: false },
  { key: "bio", default: false },
]

describe("the Columns menu (DCOL)", () => {
  function open(menu: Partial<ColumnsMenu> = {}) {
    const choices: ColumnChoices[] = []
    render(
      <ColumnsPill
        menu={{
          catalogue: CATALOGUE,
          choices: {},
          onChoices: (c) => choices.push(c),
          ...menu,
        }}
      />,
    )
    fireEvent.click(screen.getByTestId("directory-columns"))
    return choices
  }
  const headings = () =>
    ["Default columns", "More columns"].filter((h) => screen.queryByText(h))

  test("the defaults first, then the rest, each on or off as its default", () => {
    open()
    expect(headings()).toEqual(["Default columns", "More columns"])
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[]
    expect(boxes.map((b) => b.checked)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
    expect(screen.queryByText("Reset to default columns")).toBeNull()
  })

  test("a click sets a choice, even one the default already gives", () => {
    const choices = open({ choices: { reach: "off" } })
    const boxes = screen.getAllByRole("checkbox")
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[4])
    expect(choices).toEqual([
      { reach: "off", language: "off" },
      { reach: "off", bio: "on" },
    ])
  })

  test("a choice is marked, counted, and undone alone or with the rest", () => {
    const choices = open({ choices: { reach: "off", bio: "on" } })
    expect(screen.getByTestId("directory-columns").textContent).toContain(
      "2 set",
    )
    expect(document.querySelectorAll("[data-chosen]")).toHaveLength(2)
    fireEvent.click(
      screen.getByRole("button", { name: "Put Reach back to its default" }),
    )
    fireEvent.click(screen.getByText("Reset to default columns"))
    expect(choices).toEqual([{ bio: "on" }, {}])
  })

  test("Make these the defaults shows only to an Account that may, and asks twice", () => {
    open()
    expect(
      screen.queryByText("Make these the defaults for everyone"),
    ).toBeNull()
    cleanup()
    let made = 0
    open({ onMakeDefaults: () => (made += 1) })
    fireEvent.click(screen.getByText("Make these the defaults for everyone"))
    expect(made).toBe(0)
    fireEvent.click(
      screen.getByText("Click again to change everyone's defaults"),
    )
    expect(made).toBe(1)
  })

  test("search reaches a column outside the defaults", () => {
    open()
    fireEvent.change(screen.getByPlaceholderText("Search columns..."), {
      target: { value: "itself" },
    })
    expect(headings()).toEqual(["More columns"])
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
  })
})

const parse = (text: string) => parseDirectoryFilter(text) as DirectoryFilter

function mount(over: Partial<DirectoryBarProps> & { text?: string } = {}) {
  const calls = {
    filters: [] as string[],
    kinds: [] as string[][],
    choices: [] as ColumnChoices[],
    sorts: [] as string[],
    searches: [] as string[],
    fields: [] as string[][],
    matches: [] as boolean[],
    selectedFirst: [] as boolean[],
    cleared: 0,
  }
  render(
    <DirectoryBar
      filter={parse(over.text ?? OPENING_FILTER)}
      onFilter={(next) => calls.filters.push(printDirectoryFilter(next))}
      vocabulary={directoryVocabulary(
        [{ language: "fa", count: 12 }],
        ({ measure }) => <p>editor for {measure.key}</p>,
        { ticked: [], selection: [], follows: [] },
      )}
      languages={[
        { language: "fa", count: 12 },
        { language: "en", count: 3 },
        { language: null, count: 9 },
      ]}
      kinds={[]}
      onKinds={(k) => calls.kinds.push(k)}
      sortValue="mine:follows"
      onSort={(v) => calls.sorts.push(v)}
      descending
      onToggleDirection={() => {}}
      columns={{
        catalogue: CATALOGUE,
        choices: {},
        onChoices: (c) => calls.choices.push(c),
      }}
      total={1234}
      size={297_345}
      ms={360}
      search=""
      onSearch={(t) => calls.searches.push(t)}
      fields={["name", "bio", "posts"]}
      onFields={(f) => calls.fields.push(f)}
      matches
      onMatches={(m) => calls.matches.push(m)}
      selectedFirst={false}
      onSelectedFirst={(on) => calls.selectedFirst.push(on)}
      onClearAll={() => {
        calls.cleared += 1
      }}
      {...over}
    />,
  )
  return calls
}

const pressed = (testId: string) =>
  screen.getByTestId(testId).getAttribute("aria-pressed")

describe("the switches", () => {
  test("are on for the opening view, and turning one off drops its chip", () => {
    const calls = mount()
    expect(pressed("directory-switch-followed")).toBe("true")
    expect(pressed("directory-switch-dismissed")).toBe("true")
    expect(pressed("directory-switch-followable")).toBe("true")
    fireEvent.click(screen.getByTestId("directory-switch-followed"))
    expect(calls.filters).toEqual(["not is:dismissed and is:followable"])
  })

  test("Hide dismissed sits between the other two and acts as they do", () => {
    const calls = mount({ text: "is:followable" })
    const order = screen
      .getAllByTestId(/^directory-switch-(followed|dismissed|followable)$/)
      .map((el) => el.dataset.testid)
    expect(order).toEqual([
      "directory-switch-followed",
      "directory-switch-dismissed",
      "directory-switch-followable",
    ])
    expect(pressed("directory-switch-dismissed")).toBe("false")
    fireEvent.click(screen.getByTestId("directory-switch-dismissed"))
    expect(calls.filters).toEqual(["is:followable and not is:dismissed"])
  })

  test("turning one on adds its Condition", () => {
    const calls = mount({ text: "is:followable" })
    expect(pressed("directory-switch-followed")).toBe("false")
    fireEvent.click(screen.getByTestId("directory-switch-followed"))
    expect(calls.filters).toEqual(["is:followable and not is:followed"])
  })

  test("show off when their Condition sits inside an OR, and wrap it on", () => {
    const calls = mount({ text: "not is:followed or lang:fa" })
    expect(pressed("directory-switch-followed")).toBe("false")
    fireEvent.click(screen.getByTestId("directory-switch-followed"))
    expect(calls.filters).toEqual([
      "(not is:followed or lang:fa) and not is:followed",
    ])
  })
})

describe("the dropdowns", () => {
  test("Language lists each Language with its count and funnels one", () => {
    const calls = mount()
    fireEvent.click(screen.getByTestId("directory-language"))
    expect(screen.getByTestId("directory-language-count-fa").textContent).toBe(
      "12",
    )
    fireEvent.change(screen.getByPlaceholderText("Search language..."), {
      target: { value: "eng" },
    })
    expect(screen.queryByTestId("directory-language-row-fa")).toBeNull()
    fireEvent.click(screen.getByTestId("directory-language-funnel-en"))
    expect(calls.filters).toEqual([`${OPENING_FILTER} and lang:en`])
  })

  test("Filters counts the Conditions and opens a searchable picker", () => {
    const calls = mount()
    expect(screen.getByTestId("directory-filters").textContent).toContain("3")
    fireEvent.click(screen.getByTestId("directory-filters"))
    fireEvent.change(screen.getByPlaceholderText("Search conditions..."), {
      target: { value: "subs" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Subscribers" }))
    expect(screen.getByText("editor for subscribers")).toBeTruthy()
    expect(calls.filters).toEqual([])
  })

  test("Reference kinds searches and ticks a kind", () => {
    const calls = mount()
    fireEvent.click(screen.getByTestId("directory-kinds"))
    fireEvent.change(screen.getByPlaceholderText("Search reference kinds..."), {
      target: { value: "for" },
    })
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    fireEvent.click(screen.getByRole("checkbox"))
    expect(calls.kinds).toEqual([["forward"]])
    // DIR-05: it says which counts it narrows and which it never does.
    expect(
      screen.getByText(/Cited by @x and\s+Cites @x.*always count every kind/s),
    ).toBeTruthy()
  })

  test("Columns searches names and descriptions and turns one off", () => {
    const calls = mount()
    fireEvent.click(screen.getByTestId("directory-columns"))
    fireEvent.change(screen.getByPlaceholderText("Search columns..."), {
      target: { value: "median" },
    })
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    fireEvent.click(screen.getByRole("checkbox"))
    expect(calls.choices).toEqual([{ reach: "off" }])
  })

  test("Sort searches its options, the three Cited by choices among them", () => {
    const calls = mount()
    fireEvent.click(screen.getByTestId("directory-sort"))
    fireEvent.change(screen.getByPlaceholderText("Search sort options..."), {
      target: { value: "selected here" },
    })
    fireEvent.click(
      screen.getByRole("radio", { name: /Cited by channels selected here/ }),
    )
    expect(calls.sorts).toEqual(["mine:ticked"])
  })
})

describe("the filter row and the footer", () => {
  test("the row reads N of M, the Directory's size", () => {
    mount()
    expect(screen.getByTestId("directory-filter-count").textContent).toBe(
      "1234 of 297345",
    )
  })

  test("the footer has the count, the time, and the Directory's size", () => {
    mount()
    const footer = screen.getByTestId("directory-footer").textContent
    expect(footer).toContain("1,234 channels")
    expect(footer).toContain("360 ms")
    expect(footer).toContain("of 297,345 in the Directory")
  })

  test("the footer says when your channels are empty", () => {
    mount({ emptyYours: "ticked" })
    expect(screen.getByText(/No channels are selected here yet/)).toBeTruthy()
  })
})

describe("the search box (DIR-04)", () => {
  test("typing searches, and the field segment turns a field off", () => {
    const calls = mount({ fields: ["name", "bio"] })
    fireEvent.change(screen.getByLabelText("Search the Directory"), {
      target: { value: "crypto" },
    })
    expect(calls.searches).toEqual(["crypto"])
    expect(pressed("directory-search-field-name")).toBe("true")
    expect(pressed("directory-search-field-posts")).toBe("false")
    fireEvent.click(screen.getByTestId("directory-search-field-bio"))
    fireEvent.click(screen.getByTestId("directory-search-field-posts"))
    expect(calls.fields).toEqual([["name"], ["name", "bio", "posts"]])
  })

  test("the placeholder names the fields searched, in their fixed order (DFP-01)", () => {
    const placeholder = (fields: SearchField[]) => {
      cleanup()
      mount({ fields })
      return screen
        .getByLabelText("Search the Directory")
        .getAttribute("placeholder")
    }
    expect(placeholder(["name"])).toBe("Search names")
    expect(placeholder(["bio", "name"])).toBe("Search names and bios")
    expect(placeholder(["posts", "name"])).toBe("Search names and posts")
    expect(placeholder(["posts", "bio", "name"])).toBe(
      "Search names, bios and posts",
    )
  })

  test("a search is a chip even with no Condition, and the chip clears it", () => {
    const calls = mount({ text: "", search: "crypto" })
    const row = screen.getByTestId("directory-filter-row")
    expect(row.textContent).toContain('"crypto"')
    fireEvent.click(screen.getByLabelText("Clear the search"))
    expect(calls.searches).toEqual([""])
  })

  test("Clear all clears the search and the Conditions at once", () => {
    const calls = mount({ search: "crypto" })
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }))
    expect(calls.cleared).toBe(1)
    expect(calls.filters).toEqual([])
  })

  test("the sort picker offers Relevance only while searching", () => {
    mount()
    fireEvent.click(screen.getByTestId("directory-sort"))
    expect(screen.queryByRole("radio", { name: /Relevance/ })).toBeNull()
    cleanup()
    mount({ search: "crypto", sortValue: "relevance" })
    fireEvent.click(screen.getByTestId("directory-sort"))
    expect(
      screen
        .getByRole("radio", { name: /Relevance/ })
        .getAttribute("aria-checked"),
    ).toBe("true")
  })

  test("Show matches is a switch after the sort picker", () => {
    const calls = mount({ matches: true })
    const toggle = screen.getByTestId("directory-switch-matches")
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    expect(
      screen.getByTestId("directory-sort").compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    fireEvent.click(toggle)
    expect(calls.matches).toEqual([false])
  })

  test("Selected first is a switch beside Show matches", () => {
    const calls = mount({ selectedFirst: false })
    const toggle = screen.getByTestId("directory-switch-selected-first")
    expect(toggle.textContent).toBe("Selected first")
    expect(toggle.getAttribute("aria-pressed")).toBe("false")
    expect(
      screen.getByTestId("directory-switch-matches").nextElementSibling,
    ).toBe(toggle)
    fireEvent.click(toggle)
    expect(calls.selectedFirst).toEqual([true])
  })
})

describe("on a phone (DFP-02)", () => {
  const sheet = () => screen.queryByRole("dialog", { name: "Filters and sort" })

  test("the controls fold behind one button that counts the Conditions", () => {
    mount({ phone: true })
    expect(screen.queryByTestId("directory-filters")).toBeNull()
    expect(screen.queryByRole("group", { name: "Search in" })).toBeNull()
    expect(screen.getByTestId("directory-search")).toBeTruthy()
    expect(screen.getByTestId("directory-controls-button").textContent).toBe(
      "3",
    )
    expect(sheet()).toBeNull()
  })

  test("with no Condition on, the button says Filters", () => {
    mount({ phone: true, text: "" })
    expect(screen.getByTestId("directory-controls-button").textContent).toBe(
      "Filters",
    )
  })

  test("the button opens a sheet with every control and the search fields; Done closes it", () => {
    const calls = mount({ phone: true })
    fireEvent.click(screen.getByTestId("directory-controls-button"))
    const open = sheet() as HTMLElement
    expect(open).toBeTruthy()
    expect(open.querySelector('[data-testid="directory-filters"]')).toBeTruthy()
    expect(open.querySelector('[data-testid="directory-sort"]')).toBeTruthy()
    fireEvent.click(screen.getByTestId("directory-search-field-posts"))
    expect(calls.fields).toEqual([["name", "bio"]])
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(sheet()).toBeNull()
  })

  test("a wide screen keeps the controls inline and no button", () => {
    mount()
    expect(screen.getByTestId("directory-filters")).toBeTruthy()
    expect(screen.getByRole("group", { name: "Search in" })).toBeTruthy()
    expect(screen.queryByTestId("directory-controls-button")).toBeNull()
    expect(sheet()).toBeNull()
  })
})

describe("a Tag Condition (DFP-04)", () => {
  const vocabulary = directoryVocabulary(
    [],
    () => null,
    { ticked: [], selection: [], follows: [] },
    {
      tags: [{ name: "News", channels: 2 }],
      groups: ["Slow Feed"],
      loaded: true,
    },
  )

  test("a Tag or a Setting group the reader has is an ordinary chip", () => {
    mount({ text: 'tag:news and tag:"group:slow feed"', vocabulary })
    const chips = ["In the Tag news", "In the Setting group slow feed"].map(
      (name) => screen.getByRole("button", { name }),
    )
    expect(chips.map((c) => c.getAttribute("data-stale"))).toEqual([null, null])
  })

  test("a Setting group the reader lacks is struck through (TGU-04)", () => {
    mount({ text: 'group:gone and citedby:"group:Fast"', vocabulary })
    for (const name of [
      "In the Setting group gone",
      "Cited by the Setting group Fast",
    ]) {
      const chip = screen.getByRole("button", { name })
      expect(chip.getAttribute("data-stale")).toBe("true")
      expect(chip.getAttribute("title")).toContain("no Setting group")
    }
  })

  test("a Tag the reader lacks keeps its chip, struck through, and says why", () => {
    mount({ text: "tag:gone", vocabulary })
    const chip = screen.getByRole("button", { name: "In the Tag gone" })
    expect(chip.getAttribute("data-stale")).toBe("true")
    expect(chip.className).toContain("line-through")
    expect(chip.getAttribute("title")).toContain("matches nothing")
  })

  test("a Tag the reader lacks as the Seeds is struck through too (DFP-05)", () => {
    mount({
      text: 'parents:"tag:gone" and citedby:"tag:News"',
      vocabulary,
    })
    const gone = screen.getByRole("button", {
      name: "2+ shared parents with the Tag gone",
    })
    expect(gone.getAttribute("data-stale")).toBe("true")
    const known = screen.getByRole("button", { name: "Cited by the Tag News" })
    expect(known.getAttribute("data-stale")).toBeNull()
  })

  test("nothing is struck through before the Tags arrive", () => {
    mount({
      text: "tag:gone",
      vocabulary: directoryVocabulary(
        [],
        () => null,
        { ticked: [], selection: [], follows: [] },
        { tags: [], groups: [], loaded: false },
      ),
    })
    const chip = screen.getByRole("button", { name: "In the Tag gone" })
    expect(chip.getAttribute("data-stale")).toBeNull()
  })

  test("the Filters picker offers each Tag, and each Setting group apart", () => {
    const calls = mount({ text: "", vocabulary })
    fireEvent.click(screen.getByTestId("directory-filters"))
    fireEvent.click(screen.getByText("In the Tag"))
    expect(screen.queryByText("group:Slow Feed")).toBeNull()
    fireEvent.click(screen.getByText("News"))
    expect(calls.filters).toEqual(["tag:News"])
    fireEvent.click(screen.getByTestId("directory-filters"))
    fireEvent.click(screen.getByText("In the Setting group"))
    fireEvent.click(screen.getByText("Slow Feed"))
    expect(calls.filters).toEqual(["tag:News", 'group:"Slow Feed"'])
  })
})

describe("the search box's reach (DPF)", () => {
  test("a reader listed every kind is told the search finds Channels only", () => {
    const box = (everyKind: boolean) => (
      <DirectorySearch
        search=""
        onSearch={() => {}}
        fields={["name"]}
        onFields={() => {}}
        everyKind={everyKind}
      />
    )
    const view = render(box(false))
    expect(screen.getByLabelText("Search the Directory").title).toBe("")
    view.rerender(box(true))
    expect(screen.getByLabelText("Search the Directory").title).toBe(
      CHANNELS_ONLY,
    )
  })
})
