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
  }
  render(
    <DirectoryBar
      filter={parse(over.text ?? OPENING_FILTER)}
      onFilter={(next) => calls.filters.push(printDirectoryFilter(next))}
      vocabulary={directoryVocabulary(
        [{ id: "fa", label: "Persian" }],
        ({ measure }) => <p>editor for {measure.key}</p>,
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
    expect(pressed("directory-switch-followable")).toBe("true")
    fireEvent.click(screen.getByTestId("directory-switch-followed"))
    expect(calls.filters).toEqual(["is:followable"])
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
    expect(screen.getByTestId("directory-filters").textContent).toContain("2")
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
