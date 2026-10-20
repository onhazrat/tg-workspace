/**
 * The Directory detail panel (DIR-03), props-only: the entry's header, bio,
 * counters and Follow, its link to Telegram's public web view, "Why it's
 * here", the Posts, the states before and without an entry, and a panel that
 * takes the whole screen on a narrow one.
 *
 * Watched to fail on: a fixed-width column on a phone; "Why it's here"
 * leaving out the window it counts in. The row click is
 * `DirectoryTable.test.tsx`'s (a tick opening the panel fails there), and
 * the window's source is `directory-panel.test.ts`'s (a window read only
 * from the top level fails there).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import type {
  DirectoryCitingPostResponse,
  DirectoryEntryResponse,
} from "@/client"
import { directoryConditionLabel } from "@/lib/directory/directory-filter"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { DirectoryPanel } from "./DirectoryPanel"

afterEach(cleanup)

const DAY = 86_400_000

const entry = (
  over: Partial<DirectoryEntryResponse> = {},
): DirectoryEntryResponse => ({
  handle: "chan",
  displayName: "Channel Name",
  photoUrl: null,
  language: "fa",
  subscribers: 12_300,
  reach: 450,
  reachEstimated: true,
  postsPerWeek: 3.5,
  forwardShare: 0.25,
  lastPostAt: Date.now() - 86_400_000,
  foundAt: Date.now() - 3 * 86_400_000,
  photos: 10,
  videos: 2,
  files: 0,
  links: 4,
  followable: true,
  followed: false,
  dismissed: false,
  citedBy: 5,
  cites: 1,
  bio: "A bio about things",
  tags: [],
  ...over,
})

const citing = (
  channel: string,
  postId: number,
  over: Partial<DirectoryCitingPostResponse> = {},
): DirectoryCitingPostResponse => ({
  channel,
  displayName: `${channel} name`,
  postId,
  timestamp: Date.now() - postId * 3_600_000,
  kinds: ["forward"],
  text: `${channel} says ${postId}`,
  ...over,
})

function mount(over: Partial<ComponentProps<typeof DirectoryPanel>> = {}) {
  const calls = { follow: 0, close: 0, dismiss: [] as boolean[] }
  const panel = (props: typeof over) => (
    <DirectoryPanel
      handle="chan"
      entry={entry()}
      posts={[]}
      why={{ posts: [], total: 0, parents: null, children: null }}
      citedWindow={null}
      following={false}
      onFollow={() => calls.follow++}
      onDismiss={(dismissed) => calls.dismiss.push(dismissed)}
      onClose={() => calls.close++}
      neighbours={{ citedBy: [], cites: [] }}
      onFilter={() => {}}
      {...props}
    />
  )
  const view = render(panel(over))
  /** Re-renders the same panel with other props, keeping its state. */
  const remount = (next: typeof over) => view.rerender(panel(next))
  return Object.assign(calls, { remount })
}

describe("the header", () => {
  test("shows the name, the handle as a web view link, the bio and counters", () => {
    mount()
    expect(screen.getByRole("heading", { name: "Channel Name" })).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "@chan" }).getAttribute("href"),
    ).toBe(telegramWebViewChannelUrl("chan"))
    expect(screen.getByText("A bio about things").getAttribute("dir")).toBe(
      "auto",
    )
    expect(screen.getByText("12.3K")).toBeTruthy()
    expect(screen.getByTitle("Estimated Reach").textContent).toBe("~")
    expect(screen.getByText("25%")).toBeTruthy()
  })

  test("Follow follows, and a followed Channel says Following", () => {
    const calls = mount()
    fireEvent.click(screen.getByRole("button", { name: "Follow @chan" }))
    expect(calls.follow).toBe(1)
    cleanup()
    mount({ entry: entry({ followed: true }) })
    expect(screen.getByText("Following")).toBeTruthy()
  })

  test("Dismiss dismisses; a dismissed Channel withholds Follow and takes it back", () => {
    const calls = mount()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss @chan" }))
    expect(calls.dismiss).toEqual([true])
    cleanup()
    const dismissed = mount({ entry: entry({ dismissed: true }) })
    expect(screen.queryByRole("button", { name: "Follow @chan" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Take back @chan" }))
    expect(dismissed.dismiss).toEqual([false])
  })

  test("closes", () => {
    const calls = mount()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(calls.close).toBe(1)
  })

  test("takes the whole screen on a narrow one", () => {
    mount()
    const panel = screen.getByTestId("directory-panel")
    expect(panel.className).toContain("inset-0")
    expect(panel.className).toContain("md:w-[440px]")
  })
})

describe("before and without an entry", () => {
  test("loading", () => {
    mount({ entry: undefined, posts: undefined, why: undefined })
    expect(screen.getByText("Loading…")).toBeTruthy()
  })

  test("a handle the Directory does not list", () => {
    mount({ entry: null })
    expect(
      screen.getByText("The Directory holds nothing about @chan."),
    ).toBeTruthy()
  })
})

describe("why it's here", () => {
  test("lists the citing Posts with their Channel, kinds and words", () => {
    mount({
      why: {
        posts: [
          citing("src_one", 1, { kinds: ["link", "mention"] }),
          citing("src_two", 2, { text: null }),
        ],
        total: 2,
        parents: null,
        children: null,
      },
      citedWindow: { mode: "live", start: -14 * 86_400_000 },
    })
    expect(
      screen.getByText("2 Posts of your channels cite it from 2 weeks ago"),
    ).toBeTruthy()
    expect(screen.getByText("linked + mentioned it")).toBeTruthy()
    expect(screen.getByText("src_one says 1")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "src_two name" }).getAttribute("href"),
    ).toBe(telegramWebViewChannelUrl("src_two"))
    expect(
      screen
        .getAllByRole("link", { name: "Open the Post on Telegram" })[1]
        .getAttribute("href"),
    ).toBe(telegramWebViewPostUrl("src_two", 2))
  })

  test("says how many more there are past the ones listed", () => {
    mount({
      why: {
        posts: [citing("src_one", 1)],
        total: 25,
        parents: null,
        children: null,
      },
    })
    expect(screen.getByText("and 24 more")).toBeTruthy()
  })

  test("shows three citing Posts until Show more, and another Channel opens collapsed (DFP-01)", () => {
    const why = {
      posts: [1, 2, 3, 4, 5].map((n) => citing(`src_${n}`, n)),
      total: 5,
      parents: null,
      children: null,
    }
    const shown = () =>
      [1, 2, 3, 4, 5].filter((n) => screen.queryByText(`src_${n} says ${n}`))
    const view = mount({ why })
    expect(shown()).toEqual([1, 2, 3])
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more posts" }))
    expect(shown()).toEqual([1, 2, 3, 4, 5])
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }))
    expect(shown()).toEqual([1, 2, 3])
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more posts" }))
    // The same panel, switched to another Channel, as keyboard mode does.
    view.remount({ why, handle: "other" })
    expect(shown()).toEqual([1, 2, 3])
  })

  test("says when none of your channels cite it", () => {
    mount()
    expect(screen.getByText("None of your channels cite it.")).toBeTruthy()
  })

  test("reads the window in the chip's words (TB-02)", () => {
    const window = { mode: "live" as const, start: -30 * DAY, end: -DAY }
    mount({ citedWindow: window })
    expect(
      screen.getByText(
        "None of your channels cite it from 30 days ago to 1 day ago.",
      ),
    ).toBeTruthy()
    expect(directoryConditionLabel({ type: "mine", ...window })).toBe(
      "Cited by your channels from 30 days ago to 1 day ago",
    )
  })

  test("names a few shared Channels for each Shared relation on (DIR-07)", () => {
    const channel = (handle: string) => ({ handle, displayName: null })
    mount({
      why: {
        posts: [],
        total: 0,
        parents: {
          channels: [channel("s1"), channel("s2")],
          total: 7,
        },
        children: { channels: [], total: 0 },
      },
    })
    expect(
      screen.getByText(
        "Shared parents: @s1, @s2 and 5 more cite it and your Seeds",
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Shared children: none; it cites nothing your Seeds cite",
      ),
    ).toBeTruthy()
  })
})

describe("who cites it and whom it cites (DIR-05)", () => {
  const neighbour = (handle: string, references: number) => ({
    handle,
    displayName: handle === "nameless" ? null : `${handle} name`,
    references,
    kinds: ["forward" as const, "mention" as const],
  })

  test("lists both sides, with names, counts and kinds", () => {
    mount({
      neighbours: {
        citedBy: [neighbour("src_one", 12), neighbour("nameless", 1)],
        cites: [],
      },
    })
    expect(screen.getByText("Cited most by")).toBeTruthy()
    expect(screen.getByText("src_one name")).toBeTruthy()
    expect(screen.getByText("@nameless")).toBeTruthy()
    expect(screen.getByText("12 · forward, mention")).toBeTruthy()
    expect(screen.getByText("It cites no channel we know of.")).toBeTruthy()
  })

  test("one click turns a neighbour into a Condition", () => {
    const got: unknown[] = []
    mount({
      neighbours: {
        citedBy: [neighbour("src_one", 3)],
        cites: [neighbour("dst_one", 2)],
      },
      onFilter: (cond) => got.push(cond),
    })
    fireEvent.click(
      screen.getByRole("button", { name: 'Filter by "Cited by @src_one"' }),
    )
    fireEvent.click(
      screen.getByRole("button", { name: 'Filter by "Cites @dst_one"' }),
    )
    expect(got).toEqual([
      { type: "citedby", seeds: { kind: "handles", handles: ["src_one"] } },
      { type: "cites", seeds: { kind: "handles", handles: ["dst_one"] } },
    ])
  })
})

describe("the Priority boost (DPF)", () => {
  const sent: [string, number][] = []
  const onBoost = (mode: string, value: number) => sent.push([mode, value])

  test("a DATA_ADMIN reader's entry carries a boost, and the panel sets it", () => {
    mount({ entry: entry({ priorityBoost: 3, effectivePriority: 7 }), onBoost })
    expect(screen.getByTestId("directory-boost").textContent).toContain(
      "Boost3(effective 7)",
    )
    fireEvent.change(screen.getByLabelText("Priority boost"), {
      target: { value: "5" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    expect(sent).toEqual([["add", 5]])
  })

  test("anybody else's entry carries none, and the panel offers nothing", () => {
    mount({ onBoost })
    expect(screen.queryByTestId("directory-boost")).toBeNull()
  })
})
