/**
 * The Directory's search box (DIR-04) over a view held in state, as the URL
 * holds it: typing reaches the view once, after typing stops; clearing
 * reaches it in the same event, with the sort from before Relevance.
 *
 * Watched to fail on: clearing left to the debounce; every keystroke
 * committed; the sort before Relevance not remembered.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"
import { useState } from "react"
import {
  DEFAULT_VIEW,
  type DirectoryView,
} from "@/lib/directory/directory-view"
import {
  SEARCH_DEBOUNCE_MS,
  useDirectorySearchBox,
} from "./useDirectorySearchBox"

afterEach(cleanup)

const settle = (ms: number) =>
  act(() => new Promise<void>((done) => setTimeout(done, ms)))

function mount(initial: DirectoryView) {
  const patches: Partial<DirectoryView>[] = []
  const hook = renderHook(() => {
    const [view, setView] = useState(initial)
    const box = useDirectorySearchBox(view, (next) => {
      patches.push(next)
      setView((v) => ({ ...v, ...next }))
    })
    return { view, ...box }
  })
  return { hook, patches }
}

describe("the Directory search box", () => {
  test("typing reaches the view once, after it stops, sorted by Relevance", async () => {
    const { hook, patches } = mount({ ...DEFAULT_VIEW, sort: "reach" })
    act(() => hook.result.current.setSearch("cr"))
    await settle(SEARCH_DEBOUNCE_MS / 3)
    act(() => hook.result.current.setSearch("crypto"))
    expect(patches).toEqual([])
    expect(hook.result.current.draft).toBe("crypto")
    await settle(SEARCH_DEBOUNCE_MS + 100)
    expect(patches).toEqual([
      { search: "crypto", sort: "relevance", descending: true },
    ])
  })

  test("clearing applies at once and puts back the sort before Relevance", async () => {
    const { hook, patches } = mount({
      ...DEFAULT_VIEW,
      sort: "reach",
      descending: false,
    })
    act(() => hook.result.current.setSearch("crypto"))
    await settle(SEARCH_DEBOUNCE_MS + 100)
    act(() => hook.result.current.setSearch(""))
    expect(patches.at(-1)).toEqual({
      search: "",
      sort: "reach",
      descending: false,
    })
    expect(hook.result.current.view.sort).toBe("reach")
  })

  test("Clear all empties the box and the filter in one change", () => {
    const { hook, patches } = mount({
      ...DEFAULT_VIEW,
      search: "crypto",
      sort: "relevance",
    })
    act(() => hook.result.current.clearAll())
    expect(patches).toEqual([
      { search: "", sort: "mine", descending: true, filter: "" },
    ])
    expect(hook.result.current.draft).toBe("")
  })
})
