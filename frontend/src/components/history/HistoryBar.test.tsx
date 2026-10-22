/**
 * History's bar, rendered from props: each choice's count, the moment switch,
 * the footer's total and sort words, the Compact grid pill, and the phone's
 * sheet. `HistoryView` wires the queries and the URL.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ArtifactCountsResponse } from "@/client"
import {
  DEFAULT_HISTORY_PARAMS,
  type HistoryParams,
} from "@/lib/history/history-params"
import { HistoryBar } from "./HistoryBar"

afterEach(cleanup)

const COUNTS: ArtifactCountsResponse = {
  total: 53,
  kinds: { summary: 51, chat: 1, tag: 0, discovery: 4 },
  kindsAll: 56,
  statuses: { failed: 0, pending: 2 },
  statusesAll: 56,
}

function mount(
  over: Partial<HistoryParams> = {},
  extra: { counts?: ArtifactCountsResponse | null; phone?: boolean } = {},
) {
  const onChange = mock()
  const onCompact = mock()
  render(
    <HistoryBar
      params={{ ...DEFAULT_HISTORY_PARAMS, ...over }}
      onChange={onChange}
      counts={extra.counts === null ? undefined : (extra.counts ?? COUNTS)}
      spread={<p>the spread</p>}
      compact={false}
      onCompact={onCompact}
      phone={extra.phone}
    />,
  )
  return { onChange, onCompact }
}

const testId = (id: string) => screen.getByTestId(id)

/** The time filter's line, not the moment segment that shares its word. */
const timeFilter = (name: string) =>
  screen
    .queryAllByRole("button", { name })
    .find((b) => b.getAttribute("aria-haspopup") === "dialog")

describe("Kind and Status", () => {
  test("each choice says how many it would show", () => {
    mount()
    expect(testId("history-kind-all").textContent).toBe("All kinds56")
    expect(testId("history-kind-summary").textContent).toBe("Summary51")
    expect(testId("history-kind-discovery").textContent).toBe("Discovery4")
    expect(testId("history-status-all").textContent).toBe("Any status56")
    expect(testId("history-status-pending").textContent).toBe("Pending2")
  })

  test("a choice that would show nothing is dimmed but clickable", () => {
    const { onChange } = mount()
    const tag = testId("history-kind-tag")
    expect(tag.querySelector("[data-empty]")).toBeTruthy()
    expect(testId("history-kind-chat").querySelector("[data-empty]")).toBeNull()
    expect((tag as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(tag)
    expect(onChange).toHaveBeenCalledWith({ kind: "tag" })
    fireEvent.click(testId("history-status-failed"))
    expect(onChange).toHaveBeenCalledWith({ status: "failed" })
  })

  test("the chosen one is pressed, and All clears it", () => {
    const { onChange } = mount({ kind: "chat", status: "pending" })
    expect(testId("history-kind-chat").getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(testId("history-status-pending").getAttribute("aria-pressed")).toBe(
      "true",
    )
    fireEvent.click(testId("history-kind-all"))
    fireEvent.click(testId("history-status-all"))
    expect(onChange.mock.calls).toEqual([[{ kind: null }], [{ status: null }]])
  })

  test("while the counts load the choices show none", () => {
    mount({}, { counts: null })
    expect(testId("history-kind-summary").textContent).toBe("Summary")
    expect(testId("history-total").textContent).toBe("… artifacts")
  })
})

describe("search, Starred and sort", () => {
  test("typing searches and Starred toggles", () => {
    const { onChange } = mount({ starred: true })
    fireEvent.change(screen.getByLabelText("Search history"), {
      target: { value: "iran" },
    })
    expect(onChange).toHaveBeenCalledWith({ search: "iran" })
    const starred = testId("history-starred")
    expect(starred.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(starred)
    expect(onChange).toHaveBeenCalledWith({ starred: false })
  })

  test("the direction arrow flips the sort", () => {
    const { onChange } = mount()
    fireEvent.click(screen.getByRole("button", { name: "Sort descending" }))
    expect(onChange).toHaveBeenCalledWith({ descending: false })
  })
})

describe("the time filter", () => {
  test("the moment switch relabels it", () => {
    const { onChange } = mount()
    expect(timeFilter("Written")).toBeTruthy()
    fireEvent.click(testId("history-moment-window"))
    expect(onChange).toHaveBeenCalledWith({ moment: "window" })
    cleanup()
    mount({ moment: "window" })
    expect(timeFilter("Window")).toBeTruthy()
    expect(timeFilter("Written")).toBeUndefined()
  })

  test("its popover holds the spread", () => {
    mount()
    expect(screen.queryByText("the spread")).toBeNull()
    act(() => {
      fireEvent.click(timeFilter("Written") as HTMLElement)
    })
    expect(screen.getByText("the spread")).toBeTruthy()
  })
})

describe("the footer", () => {
  test("gives the total and the sort in words", () => {
    mount({ sort: "window", descending: false })
    const footer = testId("history-footer").textContent
    expect(footer).toContain("53 artifacts")
    expect(footer).toContain("Sorted by Window start, oldest first")
  })

  test("ends with the Compact grid pill", () => {
    const { onCompact } = mount()
    const pill = testId("history-compact-grid")
    expect(testId("history-footer").contains(pill)).toBe(true)
    expect(pill.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(pill)
    expect(onCompact).toHaveBeenCalledWith(true)
  })
})

describe("on a phone", () => {
  test("the search stays on top and the rest sits behind one counted button", () => {
    mount({ kind: "chat", starred: true, search: "x" }, { phone: true })
    expect(screen.getByLabelText("Search history")).toBeTruthy()
    expect(screen.queryByTestId("history-kind-chat")).toBeNull()
    const button = testId("history-controls-button")
    expect(button.textContent).toBe("2")
    act(() => {
      fireEvent.click(button)
    })
    expect(
      screen.getByRole("dialog", { name: "Filters and sort" }),
    ).toBeTruthy()
    expect(testId("history-kind-chat")).toBeTruthy()
  })
})
