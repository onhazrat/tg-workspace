/**
 * The Directory's bulk bar (DIR-02): how many are ticked, a few of their
 * handles, Follow and Clear, and the confirmation Discover asks before five
 * or more.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Whole } from "@/lib/directory/directory-view"
import { DirectoryBulkBar } from "./DirectoryBulkBar"

afterEach(cleanup)

function mount(
  handles: string[],
  busy = false,
  followed: string[] = [],
  whole?: Whole,
) {
  const calls = {
    follow: [] as string[][],
    dismiss: [] as string[][],
    clear: 0,
    tickAll: 0,
    tag: [] as [string, string[]][],
    untag: [] as [string, string[]][],
  }
  render(
    <DirectoryBulkBar
      whole={whole}
      onTickAll={() => calls.tickAll++}
      ticks={new Set(handles)}
      busy={busy}
      followed={new Set(followed)}
      onFollow={(h) => calls.follow.push(h)}
      onDismiss={(h) => calls.dismiss.push(h)}
      onClear={() => calls.clear++}
      tagging={{
        tags: [{ name: "News", channels: 2 }],
        onTag: (n, h) => calls.tag.push([n, h]),
        onUntag: (n, h) => calls.untag.push([n, h]),
      }}
    />,
  )
  return calls
}

describe("the bulk bar", () => {
  test("shows nothing while nothing is ticked", () => {
    mount([])
    expect(screen.queryByTestId("directory-bulk-bar")).toBeNull()
  })

  test("names the count and a few handles", () => {
    mount(["a", "b", "c", "d", "e"])
    expect(screen.getByText("5 ticked")).toBeTruthy()
    expect(screen.getByText("@a, @b, @c +2")).toBeTruthy()
  })

  test("follows fewer than five at once", () => {
    const calls = mount(["a", "b"])
    fireEvent.click(screen.getByRole("button", { name: "Follow 2" }))
    expect(calls.follow).toEqual([["a", "b"]])
  })

  test("asks first before five or more", () => {
    const calls = mount(["a", "b", "c", "d", "e"])
    fireEvent.click(screen.getByRole("button", { name: "Follow 5" }))
    expect(calls.follow).toEqual([])
    fireEvent.click(screen.getByTestId("directory-bulk-confirm"))
    expect(calls.follow).toEqual([["a", "b", "c", "d", "e"]])
  })

  test("Dismiss dismisses every tick at once, without asking", () => {
    const calls = mount(["a", "b", "c", "d", "e"])
    fireEvent.click(screen.getByRole("button", { name: "Dismiss 5" }))
    expect(calls.dismiss).toEqual([["a", "b", "c", "d", "e"]])
  })

  test("Clear empties the ticks, and a running follow holds both", () => {
    const calls = mount(["a"])
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(calls.clear).toBe(1)
    cleanup()
    mount(["a"], true)
    expect(
      (screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  test("Follow and Dismiss act on the unfollowed ticks only, and say of how many", () => {
    // `followed` is lowercase; a tick keeps the handle's own case.
    const calls = mount(["a", "News", "c"], false, ["news"])
    expect(screen.getByText("3 ticked")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Follow 2 of 3" }))
    fireEvent.click(screen.getByRole("button", { name: "Dismiss 2 of 3" }))
    expect(calls.follow).toEqual([["a", "c"]])
    expect(calls.dismiss).toEqual([["a", "c"]])
  })

  test("asks first only when five or more would be followed", () => {
    const calls = mount(["a", "b", "c", "d", "e"], false, ["e"])
    fireEvent.click(screen.getByRole("button", { name: "Follow 4 of 5" }))
    expect(calls.follow).toEqual([["a", "b", "c", "d"]])
  })

  test("with only follows ticked, says so and offers neither Follow nor Dismiss", () => {
    mount(["a", "b"], false, ["a", "b"])
    expect(screen.getByText("All followed")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Follow/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Dismiss/ })).toBeNull()
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy()
  })
})

describe("tagging the Ticks (DFP-04)", () => {
  test("Tag and Untag act on every Tick, followed or not", () => {
    const calls = mount(["a", "b"], false, ["a"])
    expect(screen.getByTestId("directory-bulk-tag").textContent).toContain(
      "Tag 2",
    )
    fireEvent.click(screen.getByTestId("directory-bulk-tag"))
    fireEvent.change(screen.getByTestId("directory-tag-search"), {
      target: { value: "fresh" },
    })
    fireEvent.click(screen.getByText('Create the Tag "fresh"'))
    expect(calls.tag).toEqual([["fresh", ["a", "b"]]])
    fireEvent.click(screen.getByTestId("directory-bulk-untag"))
    fireEvent.click(screen.getByRole("checkbox", { name: /News/ }))
    expect(calls.untag).toEqual([["News", ["a", "b"]]])
  })

  test("Untag never offers a group: Tag, and is absent with only those", () => {
    render(
      <DirectoryBulkBar
        ticks={new Set(["a"])}
        busy={false}
        followed={new Set()}
        onFollow={() => {}}
        onDismiss={() => {}}
        onClear={() => {}}
        tagging={{
          tags: [{ name: "group:Fast", channels: 2 }],
          onTag: () => {},
          onUntag: () => {},
        }}
      />,
    )
    expect(screen.queryByTestId("directory-bulk-untag")).toBeNull()
  })
})

describe("the Priority boost (DPF)", () => {
  test("is offered to a DATA_ADMIN reader only, and boosts every Tick", () => {
    const sent: [string[], string, number][] = []
    const bar = (boostable: boolean) => (
      <DirectoryBulkBar
        ticks={new Set(["a", "b"])}
        busy={false}
        followed={new Set(["a"])}
        onFollow={() => {}}
        onDismiss={() => {}}
        onClear={() => {}}
        boostable={boostable}
        onBoost={(h, m, v) => sent.push([h, m, v])}
      />
    )
    const view = render(bar(false))
    expect(screen.queryByTestId("directory-boost")).toBeNull()
    view.rerender(bar(true))
    fireEvent.change(screen.getByLabelText("Priority boost"), {
      target: { value: "1" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Set" }))
    // A followed Tick is boosted too: the queue is not about who follows.
    expect(sent).toEqual([[["a", "b"], "set", 1]])
  })
})

describe("tick all that match (ADR-031)", () => {
  const page = Array.from({ length: 100 }, (_, i) => `h${i}`)

  test("offers the whole view once the page is ticked", () => {
    const calls = mount(page, false, [], { total: 4213, state: "offer" })
    fireEvent.click(
      screen.getByRole("button", { name: "Tick all 4,213 that match" }),
    )
    expect(calls.tickAll).toBe(1)
  })

  test("offers All matching for a view over 10,000", () => {
    mount(page, false, [], { total: 48210, state: "offer" })
    expect(
      screen.getByRole("button", { name: "Act on all 48,210 matching" }),
    ).toBeTruthy()
  })

  test("says when every match became a Tick", () => {
    mount(page, false, [], { total: 4213, state: "ticked" })
    expect(screen.getByText("All 4,213 matching are ticked.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Tick all/ })).toBeNull()
  })

  test("All matching says why, and turns Follow off", () => {
    mount(page, false, [], { total: 48210, state: "held" })
    const bar = screen.getByTestId("directory-bulk-bar")
    expect(bar.textContent).toContain("All 48,210 matching.")
    expect(bar.textContent).toContain(
      "Over 10,000, so they are held as this view, not ticked",
    )
    const follow = screen.getByRole("button", {
      name: "Follow",
    }) as HTMLButtonElement
    expect(follow.disabled).toBe(true)
    expect(follow.closest("[title]")?.getAttribute("title")).toBe(
      "Follow acts on 10,000 or fewer",
    )
  })

  test("All matching asks before Dismiss, and offers no Undo", () => {
    const calls = mount(page, false, [], { total: 48210, state: "held" })
    fireEvent.click(screen.getByRole("button", { name: "Dismiss all" }))
    expect(calls.dismiss).toEqual([])
    expect(
      screen.getByText(
        "Dismiss up to 48,210 channels? Followed ones are skipped. This hides them in Discover and the Directory. There is no Undo for more than 10,000.",
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByTestId("directory-bulk-dismiss-confirm"))
    expect(calls.dismiss.length).toBe(1)
  })
})
