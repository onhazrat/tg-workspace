/**
 * The detail panel's sample list (DIR-03), props-only: the newest three until
 * "Show N more", long Posts clamped until "Read more", media marked, a Post
 * with no words shown as media only, and the Links its text hides listed
 * under it, every link opening Telegram's public web view.
 *
 * Watched to fail on: every Post shown at once; the expansion kept across
 * Channels; no clamp; media only read as "no words" alone, missing `[photo]`;
 * a hidden Link's chip opening its raw address; no capture time on the View
 * count; every Link listed whether the text shows it or not.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DirectorySamplePostResponse } from "@/client"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { DirectorySamples } from "./DirectorySamples"

afterEach(cleanup)

const post = (
  postId: number,
  over: Partial<DirectorySamplePostResponse> = {},
): DirectorySamplePostResponse => ({
  postId,
  text: `post ${postId}`,
  timestamp: Date.now() - postId * 3_600_000,
  views: 1200,
  capturedAt: Date.now() - 86_400_000,
  hasMedia: false,
  links: [],
  ...over,
})

const five = [1, 2, 3, 4, 5].map((id) => post(id))
const shown = () =>
  screen
    .queryAllByTestId(/^directory-sample-\d+$/)
    .map((el) => el.dataset.testid)

describe("the sample list", () => {
  test("shows the newest three, then all of them, then three again", () => {
    render(<DirectorySamples handle="chan" posts={five} />)
    expect(shown()).toEqual([
      "directory-sample-1",
      "directory-sample-2",
      "directory-sample-3",
    ])
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more posts" }))
    expect(shown()).toHaveLength(5)
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }))
    expect(shown()).toHaveLength(3)
  })

  test("another Channel opens collapsed", () => {
    const view = render(<DirectorySamples handle="one" posts={five} />)
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more posts" }))
    view.rerender(<DirectorySamples handle="two" posts={five} />)
    expect(shown()).toHaveLength(3)
  })

  test("offers no Show more for three or fewer", () => {
    render(<DirectorySamples handle="chan" posts={five.slice(0, 3)} />)
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull()
  })

  test("says so when nothing is stored", () => {
    render(<DirectorySamples handle="chan" posts={[]} />)
    expect(screen.getByText("No sample posts stored.")).toBeTruthy()
  })

  test("clamps a long Post until Read more", () => {
    render(
      <DirectorySamples
        handle="chan"
        posts={[post(1, { text: "word ".repeat(80) }), post(2)]}
      />,
    )
    const text = screen.getByTestId("directory-sample-text-1")
    expect(text.className).toContain("line-clamp-6")
    expect(
      screen.getByTestId("directory-sample-text-2").className,
    ).not.toContain("line-clamp-6")
    fireEvent.click(screen.getByRole("button", { name: "Read more" }))
    expect(text.className).not.toContain("line-clamp-6")
    fireEvent.click(screen.getByRole("button", { name: "Less" }))
    expect(text.className).toContain("line-clamp-6")
  })

  test("shows each View count with when it was counted", () => {
    render(<DirectorySamples handle="chan" posts={[post(1)]} />)
    const views = screen.getByText("1.2K")
    expect(views.closest("[title]")?.getAttribute("title")).toMatch(
      /^1,200 views, counted /,
    )
  })

  test("marks media, and a Post with no words is media only", () => {
    render(
      <DirectorySamples
        handle="chan"
        posts={[
          post(1, { hasMedia: true }),
          post(2, { hasMedia: true, text: "" }),
          post(3, { hasMedia: true, text: "[photo]" }),
        ]}
      />,
    )
    expect(screen.getAllByText("has media")).toHaveLength(1)
    expect(screen.getAllByText("Media only, no text")).toHaveLength(2)
  })

  test("links what the text shows and lists the Links it hides", () => {
    render(
      <DirectorySamples
        handle="chan"
        posts={[
          post(1, {
            text: "read @shown_chan or click here",
            links: [
              { url: "https://t.me/shown_chan", channel: "shown_chan" },
              { url: "https://t.me/hidden_chan/9", channel: "hidden_chan" },
            ],
          }),
        ]}
      />,
    )
    expect(
      screen.getByTestId("post-mention-link-shown_chan").getAttribute("href"),
    ).toBe(telegramWebViewChannelUrl("shown_chan"))
    const chips = screen.getAllByTestId("directory-sample-hidden-link")
    expect(chips.map((a) => a.getAttribute("href"))).toEqual([
      telegramWebViewPostUrl("hidden_chan", 9),
    ])
  })

  test("each Post opens Telegram's public web view", () => {
    render(<DirectorySamples handle="chan" posts={[post(7)]} />)
    expect(
      screen
        .getByRole("link", { name: "Open the Post on Telegram" })
        .getAttribute("href"),
    ).toBe(telegramWebViewPostUrl("chan", 7))
  })
})
