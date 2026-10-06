/**
 * The Directory's bar (DIR-02), props-only: the switches edit the filter's
 * own Conditions and show off inside an OR, every dropdown opens on a search,
 * the Language funnel and the Filters picker add Conditions, and the footer
 * says when "your channels" is empty.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  type DirectoryFilter,
  OPENING_FILTER,
  parseDirectoryFilter,
  printDirectoryFilter,
} from "@/lib/directory/directory-filter"
import { DirectoryBar, type DirectoryBarProps } from "./DirectoryBar"
import { directoryVocabulary } from "./directory-vocabulary"

afterEach(cleanup)

const parse = (text: string) => parseDirectoryFilter(text) as DirectoryFilter

function mount(over: Partial<DirectoryBarProps> & { text?: string } = {}) {
  const calls = {
    filters: [] as string[],
    kinds: [] as string[][],
    hidden: [] as string[][],
    sorts: [] as string[],
    searches: [] as string[],
    fields: [] as string[][],
    matches: [] as boolean[],
    cleared: 0,
  }
  render(
    <DirectoryBar
      filter={parse(over.text ?? OPENING_FILTER)}
      onFilter={(next) => calls.filters.push(printDirectoryFilter(next))}
      vocabulary={directoryVocabulary(
        [{ language: "fa", count: 12 }],
        ({ measure }) => <p>editor for {measure.key}</p>,
        { picked: [], selection: [], follows: [] },
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
      hidden={[]}
      onHidden={(h) => calls.hidden.push(h)}
      total={1234}
      size={297_345}
      ms={360}
      search=""
      onSearch={(t) => calls.searches.push(t)}
      fields={["name", "bio", "posts"]}
      onFields={(f) => calls.fields.push(f)}
      matches
      onMatches={(m) => calls.matches.push(m)}
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

  test("Columns searches names and descriptions and hides one", () => {
    const calls = mount()
    fireEvent.click(screen.getByTestId("directory-columns"))
    fireEvent.change(screen.getByPlaceholderText("Search columns..."), {
      target: { value: "median" },
    })
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    fireEvent.click(screen.getByRole("checkbox"))
    expect(calls.hidden).toEqual([["reach"]])
  })

  test("Sort searches its options, the three Cited by choices among them", () => {
    const calls = mount()
    fireEvent.click(screen.getByTestId("directory-sort"))
    fireEvent.change(screen.getByPlaceholderText("Search sort options..."), {
      target: { value: "ticked" },
    })
    fireEvent.click(
      screen.getByRole("radio", { name: /Cited by channels ticked here/ }),
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
    expect(screen.getByText(/No channels are ticked here yet/)).toBeTruthy()
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
})
