/**
 * The Directory's table (DIR-02), props-only: the columns of user story 7
 * (Cited by and Cites come with DIR-05), ticks with the followed ones locked,
 * the header's partial tick, sorting from a header, Follow, the Telegram web
 * view link and the pages.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import type { DirectoryRowResponse } from "@/client"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { DirectoryTable } from "./DirectoryTable"

afterEach(cleanup)

const row = (handle: string, over: Partial<DirectoryRowResponse> = {}) =>
  ({
    handle,
    displayName: `${handle} name`,
    photoUrl: null,
    language: "fa",
    subscribers: 12_300,
    reach: 450,
    reachEstimated: false,
    postsPerWeek: 3.25,
    forwardShare: 0.4,
    lastPostAt: Date.now() - 86_400_000,
    foundAt: Date.now() - 3 * 86_400_000,
    photos: 1,
    videos: 2,
    files: 3,
    links: 4,
    followable: true,
    followed: false,
    dismissed: false,
    citedBy: 0,
    cites: 0,
    mine: 2,
    mineLastAt: Date.now() - 3_600_000,
    match: null,
    sharedParents: null,
    sharedChildren: null,
    ...over,
  }) satisfies DirectoryRowResponse

function mount(over: Partial<ComponentProps<typeof DirectoryTable>> = {}) {
  const calls: {
    ticks: string[][]
    sort: string[]
    follow: string[]
    page: number[]
    open: string[]
    dismiss: [string, boolean][]
  } = { ticks: [], sort: [], follow: [], page: [], open: [], dismiss: [] }
  render(
    <DirectoryTable
      rows={[row("alpha"), row("beta"), row("gamma", { followed: true })]}
      total={250}
      page={0}
      sort="mine"
      descending
      hidden={[]}
      ticks={new Set()}
      onTicks={(next) => calls.ticks.push([...next].sort())}
      following={new Set()}
      onFollow={(h) => calls.follow.push(h)}
      onDismiss={(h, dismissed) => calls.dismiss.push([h, dismissed])}
      onSort={(key) => calls.sort.push(key)}
      onPage={(p) => calls.page.push(p)}
      onOpen={(h) => calls.open.push(h)}
      {...over}
    />,
  )
  return calls
}

const box = (name: string) =>
  screen.getByRole("checkbox", { name }) as HTMLInputElement

describe("the rows", () => {
  test("a handle is a Telegram web view link in a new tab", () => {
    mount()
    const link = screen.getByRole("link", { name: "@alpha" })
    expect(link.getAttribute("href")).toBe(telegramWebViewChannelUrl("alpha"))
    expect(link.getAttribute("target")).toBe("_blank")
  })

  test("names lay out in their own direction, and an estimated Reach says so", () => {
    mount({ rows: [row("alpha", { reachEstimated: true })] })
    expect(screen.getByText("alpha name").getAttribute("dir")).toBe("auto")
    expect(screen.getByTitle("Estimated Reach").textContent).toBe("~")
  })

  test("Follow follows one, a followed row says so, a running one waits", () => {
    const calls = mount({ following: new Set(["beta"]) })
    fireEvent.click(screen.getByRole("button", { name: "Follow @alpha" }))
    expect(calls.follow).toEqual(["alpha"])
    expect(
      (
        screen.getByRole("button", {
          name: "Follow @beta",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(screen.getByText("Following")).toBeTruthy()
  })
})

describe("Dismissal", () => {
  test("Dismiss dismisses one row without opening the panel", () => {
    const calls = mount()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss @alpha" }))
    expect(calls.dismiss).toEqual([["alpha", true]])
    expect(calls.open).toEqual([])
  })

  test("a dismissed row is dimmed, withholds Follow and takes it back", () => {
    const calls = mount({ rows: [row("alpha", { dismissed: true })] })
    expect(screen.queryByRole("button", { name: "Follow @alpha" })).toBeNull()
    expect(screen.getByTestId("directory-row-alpha").className).toContain(
      "opacity-50",
    )
    fireEvent.click(screen.getByRole("button", { name: "Take back @alpha" }))
    expect(calls.dismiss).toEqual([["alpha", false]])
    expect(calls.open).toEqual([])
  })
})

describe("opening the panel", () => {
  test("a click on the row opens it; its link, tick and Follow do not", () => {
    const calls = mount()
    fireEvent.click(screen.getByText("alpha name"))
    fireEvent.click(screen.getByRole("link", { name: "@beta" }))
    fireEvent.click(box("Tick @beta"))
    fireEvent.click(screen.getByRole("button", { name: "Follow @beta" }))
    expect(calls.open).toEqual(["alpha"])
  })
})

describe("ticks", () => {
  test("a followed row is ticked and locked", () => {
    mount()
    expect(box("@gamma already followed").checked).toBe(true)
    expect(box("@gamma already followed").disabled).toBe(true)
  })

  test("the header ticks every unfollowed row on the page", () => {
    const calls = mount({ ticks: new Set(["zeta"]) })
    fireEvent.click(box("Tick every unfollowed channel on this page"))
    expect(calls.ticks).toEqual([["alpha", "beta", "zeta"]])
  })

  test("the header is partial while some are ticked, and a row ticks itself", () => {
    const calls = mount({ ticks: new Set(["alpha"]) })
    expect(
      box("Tick every unfollowed channel on this page").indeterminate,
    ).toBe(true)
    fireEvent.click(box("Tick @beta"))
    expect(calls.ticks).toEqual([["alpha", "beta"]])
  })
})

describe("columns and sorting", () => {
  test("a hidden column is gone; the Channel and the actions stay", () => {
    mount({ hidden: ["reach", "language"] })
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent)
    expect(headers).not.toContain("Reach")
    expect(headers).not.toContain("Lang")
    expect(headers).toContain("Channel")
    expect(headers).toContain("Subs")
  })

  test("Cited by and Cites show their counts and sort by them", () => {
    const calls = mount({
      rows: [row("alpha", { citedBy: 1234, cites: 7 })],
      hidden: ["mine"],
    })
    const cells = screen
      .getByTestId("directory-row-alpha")
      .querySelectorAll("td")
    const texts = [...cells].map((c) => c.textContent)
    expect(texts).toContain("1.23K")
    expect(texts).toContain("7")
    fireEvent.click(screen.getByRole("button", { name: "Cited by" }))
    fireEvent.click(screen.getByRole("button", { name: "Cites" }))
    expect(calls.sort).toEqual(["cited_by", "cites"])
  })

  test("a Shared column shows only while its Condition is on, and sorts (DIR-07)", () => {
    mount()
    const headers = () =>
      screen.getAllByRole("columnheader").map((h) => h.textContent)
    expect(headers()).not.toContain("Parents")
    cleanup()
    const calls = mount({
      rows: [
        row("alpha", { sharedParents: 3 }),
        row("beta", { sharedParents: 0 }),
      ],
    })
    expect(headers()).toContain("Parents")
    expect(headers()).not.toContain("Children")
    const texts = [
      ...screen.getByTestId("directory-row-alpha").querySelectorAll("td"),
    ].map((c) => c.textContent)
    expect(texts).toContain("3")
    fireEvent.click(screen.getByRole("button", { name: "Parents" }))
    expect(calls.sort).toEqual(["shared_parents"])
  })

  test("a header sorts by its column, and the sorted one shows its arrow", () => {
    const calls = mount({ sort: "subscribers" })
    fireEvent.click(screen.getByRole("button", { name: /Last post/ }))
    expect(calls.sort).toEqual(["last_post_days"])
    expect(
      screen
        .getByRole("columnheader", { name: /Subs/ })
        .getAttribute("aria-sort"),
    ).toBe("descending")
  })
})

describe("pages", () => {
  test("previous and next, with where the page is in the total", () => {
    const calls = mount({ page: 1 })
    expect(screen.getByText("101–200 of 250")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }))
    expect(calls.page).toEqual([2, 0])
  })

  test("the last page has no next", () => {
    mount({ page: 2 })
    expect(
      (screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})

describe("the matches (DIR-04)", () => {
  const match = {
    bio: [
      { text: "Daily ", hit: false },
      { text: "crypto", hit: true },
      { text: " news", hit: false },
    ],
    post: {
      postId: 42,
      timestamp: Date.now() - 7_200_000,
      parts: [
        { text: "…", hit: false },
        { text: "<b>Crypto</b>", hit: true },
        { text: " is up", hit: false },
      ],
    },
  }

  test("a row with a match quotes its bio and Post, matched words marked", () => {
    mount({ rows: [row("alpha", { match }), row("beta")] })
    const quote = screen.getByTestId("directory-match-alpha")
    expect(quote.textContent).toContain("Daily crypto news")
    expect(
      [...quote.querySelectorAll("mark")].map((m) => m.textContent),
    ).toEqual(["crypto", "<b>Crypto</b>"])
    // Plain text, never markup.
    expect(quote.querySelector("b")).toBeNull()
    expect(screen.queryByTestId("directory-match-beta")).toBeNull()
  })

  test("the quoted Post links to its web view without opening the panel", () => {
    const calls = mount({ rows: [row("alpha", { match })] })
    const link = screen.getByTestId("directory-match-post-alpha")
    expect(link.getAttribute("href")).toBe(telegramWebViewPostUrl("alpha", 42))
    expect(link.getAttribute("target")).toBe("_blank")
    fireEvent.click(link)
    expect(calls.open).toEqual([])
    fireEvent.click(screen.getByTestId("directory-match-alpha"))
    expect(calls.open).toEqual(["alpha"])
  })

  test("a name-only match quotes nothing", () => {
    mount({ rows: [row("alpha", { match: { bio: null, post: null } })] })
    expect(screen.queryByTestId("directory-match-alpha")).toBeNull()
  })
})
