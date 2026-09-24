/**
 * The pieces `PostCard` is assembled from. The views take props only, so they
 * render without providers and without `mock.module` (process-wide in bun, see
 * `DataContext.test.tsx`). What is pinned is what the card did before it was
 * split: when a post collapses, the Translate button's four states, the quota
 * errors the card must stay quiet about, and which header and media pieces a
 * post earns.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { isTranslationQuotaError } from "@/lib/translations/translation-errors"
import type { Post } from "@/types"
import { PostCardActions } from "./PostCardActions"
import { PostCardBody } from "./PostCardBody"
import { PostCardIdentity } from "./PostCardHeader"
import { PostCardMedia } from "./PostCardMedia"
import {
  isLongPost,
  mediaBadgeSuffix,
  nextTranslateStep,
  postTime,
} from "./post-card-model"

afterEach(cleanup)

const post: Post = {
  id: 42,
  channelName: "durov",
  text: "hello",
  date: "2026-01-02T03:04:05Z",
  timestamp: 0,
}

describe("post-card-model", () => {
  test("a post collapses past 900 characters or 14 lines", () => {
    expect(isLongPost("x".repeat(900))).toBe(false)
    expect(isLongPost("x".repeat(901))).toBe(true)
    expect(isLongPost(Array(14).fill("l").join("\n"))).toBe(false)
    expect(isLongPost(Array(15).fill("l").join("\n"))).toBe(true)
  })

  test("the Grouped badge counts an album of more than one", () => {
    const album = (n: number) => ({
      ...post,
      media: { kinds: ["grouped"], groupedCount: n },
    })
    expect(mediaBadgeSuffix("grouped", album(3) as Post)).toBe(" (3)")
    expect(mediaBadgeSuffix("grouped", album(1) as Post)).toBe("")
    expect(mediaBadgeSuffix("photo", album(3) as Post)).toBe("")
  })

  test("an older row without a timestamp falls back to its date", () => {
    expect(postTime({ ...post, timestamp: 5 })).toBe(5)
    expect(postTime(post)).toBe(Date.parse("2026-01-02T03:04:05Z"))
  })

  test("Translate fetches once, then toggles, and ignores clicks while busy", () => {
    const s = (translating: boolean, translated: boolean, showing: boolean) =>
      nextTranslateStep({ translating, translated, showing })
    expect(s(true, false, false)).toBe("ignore")
    expect(s(true, true, true)).toBe("ignore")
    expect(s(false, false, false)).toBe("fetch")
    expect(s(false, true, false)).toBe("show")
    expect(s(false, true, true)).toBe("hide")
  })

  test("quota and 429 failures belong to TranslationContext", () => {
    expect(isTranslationQuotaError(new Error("Quota exceeded"))).toBe(true)
    expect(isTranslationQuotaError("HTTP 429")).toBe(true)
    expect(isTranslationQuotaError(new Error("network down"))).toBe(false)
  })
})

describe("PostCardIdentity", () => {
  const renderIdentity = (p: Post, follows = false) => {
    const onAddChannel = mock()
    render(
      <PostCardIdentity
        post={p}
        channel={undefined}
        followsForwardSource={follows}
        onAddChannel={onAddChannel}
        postSearch=""
      />,
    )
    return onAddChannel
  }

  test("shows the channel initial, the post id, and no reply or forward by default", () => {
    renderIdentity(post)
    expect(screen.getByText("d")).toBeTruthy()
    expect(screen.getByTestId("post-id-link-durov-42").textContent).toContain(
      "42",
    )
    expect(screen.queryByTestId("post-reply-badge-durov-42")).toBeNull()
    expect(screen.queryByText("Forwarded from:")).toBeNull()
  })

  test("a reply links to the post it answers", () => {
    renderIdentity({ ...post, replyToPostId: 7 })
    const link = screen.getByText("7").closest("a") as HTMLAnchorElement
    expect(link.href).toContain("/durov/7")
  })

  test("an unfollowed forward source offers to add it; a followed one does not", () => {
    const forwarded = {
      ...post,
      forwardedFrom: "src",
      forwardedFromName: "Source",
    }
    const onAdd = renderIdentity(forwarded)
    fireEvent.click(screen.getByTitle("Add @src to workspace"))
    expect(onAdd).toHaveBeenCalledWith("src")
    cleanup()
    renderIdentity(forwarded, true)
    expect(screen.queryByTitle("Add @src to workspace")).toBeNull()
    expect(screen.getByText("Source")).toBeTruthy()
  })
})

describe("PostCardActions", () => {
  test("translate and related appear only when offered", () => {
    render(<PostCardActions post={post} />)
    expect(screen.queryByLabelText("Translate")).toBeNull()
    expect(screen.queryByLabelText("Find Related Posts")).toBeNull()
    expect(screen.getByLabelText("Copy Link")).toBeTruthy()
    expect(
      (screen.getByLabelText("Open in Telegram") as HTMLAnchorElement).href,
    ).toContain("/durov/42")
  })

  test("the translate button names what a click will do", () => {
    const onToggle = mock()
    const onFindRelated = mock()
    render(
      <PostCardActions
        post={post}
        translation={{ showing: true, busy: false, onToggle }}
        onFindRelated={onFindRelated}
      />,
    )
    fireEvent.click(screen.getByLabelText("Show Original"))
    fireEvent.click(screen.getByLabelText("Find Related Posts"))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onFindRelated).toHaveBeenCalledTimes(1)
  })
})

describe("PostCardMedia", () => {
  test("renders nothing for a text-only post", () => {
    const { container } = render(<PostCardMedia post={post} />)
    expect(container.innerHTML).toBe("")
  })

  test("badges each media kind and shows the view count", () => {
    render(
      <PostCardMedia
        post={
          {
            ...post,
            media: {
              kinds: ["photo", "grouped"],
              groupedCount: 4,
              viewsCount: 1500,
            },
          } as Post
        }
      />,
    )
    expect(screen.getByTestId("post-card-media-badge-photo")).toBeTruthy()
    expect(
      screen.getByTestId("post-card-media-badge-grouped").textContent,
    ).toContain("(4)")
    expect(screen.getByText("1.5K")).toBeTruthy()
  })
})

describe("PostCardBody", () => {
  test("a short post shows no toggle", () => {
    render(<PostCardBody text="short" linkSpans={null} postSearch="" />)
    expect(screen.queryByText("Show More")).toBeNull()
  })

  test("a long post collapses and expands", () => {
    const { container } = render(
      <PostCardBody text={"x".repeat(1000)} linkSpans={null} postSearch="" />,
    )
    const body = () => container.querySelector("p") as HTMLElement
    expect(body().className).toContain("max-h-64")
    fireEvent.click(screen.getByText("Show More"))
    expect(body().className).not.toContain("max-h-64")
    expect(screen.getByText("Collapse")).toBeTruthy()
  })
})
