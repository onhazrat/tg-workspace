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
import { Toaster } from "sonner"
import { isTranslationQuotaError } from "@/lib/translations/translation-errors"
import type { Post } from "@/types"
import { PostCardBody, PostCardClampedBody } from "./PostCardBody"
import {
  PostCardActions,
  PostCardReactions,
  PostCardViews,
} from "./PostCardFooter"
import { PostCardCompactHeader, PostCardHeader } from "./PostCardHeader"
import { PostCardMedia } from "./PostCardMedia"
import { PostCardView } from "./PostCardView"
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

describe("PostCardHeader", () => {
  const renderIdentity = (p: Post, follows = false) => {
    const onAddChannel = mock()
    render(
      <PostCardHeader
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
    expect(screen.queryByText(/Forwarded from/)).toBeNull()
  })

  test("names the Channel, its handle linking to Telegram", () => {
    renderIdentity(post)
    expect(screen.getByText("durov")).toBeTruthy()
    const handle = screen.getByTestId(
      "post-channel-link-durov",
    ) as HTMLAnchorElement
    expect(handle.textContent).toBe("@durov")
    expect(handle.href).toContain("durov")
  })

  test("a reply links to the post it answers and shows how it starts", () => {
    renderIdentity({
      ...post,
      replyToPostId: 7,
      replyTo: { text: "the question", url: null },
    } as Post)
    const link = screen.getByTestId(
      "post-reply-badge-durov-42",
    ) as HTMLAnchorElement
    expect(link.href).toContain("/durov/7")
    expect(link.textContent).toContain("Reply to #7")
    expect(link.textContent).toContain("the question")
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

describe("PostCardCompactHeader", () => {
  test("keeps the reply and forward under its one line", () => {
    render(
      <PostCardCompactHeader
        post={{ ...post, replyToPostId: 7, forwardedFrom: "src" }}
        channel={undefined}
        followsForwardSource={false}
        onAddChannel={() => {}}
        postSearch=""
      />,
    )
    expect(screen.getByTestId("post-reply-badge-durov-42")).toBeTruthy()
    expect(screen.getByTitle("Add @src to workspace")).toBeTruthy()
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

  test("translate names itself when labels are on, and every action has its letter", () => {
    render(
      <PostCardActions
        post={post}
        labels
        translation={{ showing: false, busy: false, onToggle: () => {} }}
        onFindRelated={() => {}}
      />,
    )
    expect(screen.getByLabelText("Translate").textContent).toBe("Translate")
    const letter = (label: string) =>
      (screen.getByLabelText(label) as HTMLElement).dataset.shortcut
    expect(letter("Translate")).toBe("t")
    expect(letter("Find Related Posts")).toBe("r")
    expect(letter("Copy Link")).toBe("c")
    expect(letter("Open in Telegram")).toBe("o")
  })

  test("copy link writes the Post's address and confirms with a toast", async () => {
    const writeText = mock((_text: string) => Promise.resolve())
    const real = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    try {
      render(
        <>
          <Toaster />
          <PostCardActions post={post} />
        </>,
      )
      fireEvent.click(screen.getByLabelText("Copy Link"))
      expect(writeText.mock.calls[0]?.[0]).toContain("/durov/42")
      expect(await screen.findByText("Link copied")).toBeTruthy()
    } finally {
      if (real) Object.defineProperty(navigator, "clipboard", real)
      else delete (navigator as { clipboard?: unknown }).clipboard
    }
  })
})

describe("PostCardViews", () => {
  test("shows the count short, the exact number on hover", () => {
    render(<PostCardViews post={{ ...post, viewsCount: 1500 }} />)
    expect(screen.getByText("1.5K")).toBeTruthy()
    expect(screen.getByTitle("1,500 views")).toBeTruthy()
  })

  test("an unknown view count renders nothing", () => {
    const { container } = render(
      <PostCardViews post={{ ...post, viewsCount: null }} />,
    )
    expect(container.innerHTML).toBe("")
  })
})

describe("PostCardReactions", () => {
  const reacted = (reactionCounts: Post["reactionCounts"]) => ({
    ...post,
    reactionCounts,
  })
  const chips = () =>
    screen.getAllByTestId("post-card-reaction").map((el) => el.textContent)

  test("most frequent first, four at most, then +N", () => {
    render(
      <PostCardReactions
        post={reacted([
          { emoji: "👍", count: 5 },
          { emoji: "🔥", count: 1200 },
          { emoji: "😢", count: 2 },
          { emoji: "🎉", count: 9 },
          { emoji: "🤔", count: 1 },
          { emoji: "👀", count: 3 },
        ])}
      />,
    )
    expect(chips()).toEqual(["🔥1.2K", "🎉9", "👍5", "👀3"])
    expect(screen.getByText("+2")).toBeTruthy()
  })

  test("a paid chip is a star and a custom emoji a neutral glyph", () => {
    render(
      <PostCardReactions
        post={reacted([
          { isPaid: true, count: 4 },
          { customEmojiId: "123", count: 3 },
        ])}
      />,
    )
    expect(chips()).toEqual(["⭐4", "◆3"])
  })

  test("no reactions renders nothing", () => {
    const { container } = render(<PostCardReactions post={reacted(null)} />)
    expect(container.innerHTML).toBe("")
  })
})

describe("PostCardMedia", () => {
  test("renders nothing for a text-only post", () => {
    const { container } = render(<PostCardMedia post={post} />)
    expect(container.innerHTML).toBe("")
  })

  test("badges each media kind", () => {
    render(
      <PostCardMedia
        post={
          {
            ...post,
            media: { kinds: ["photo", "grouped"], groupedCount: 4 },
            viewsCount: 1500,
          } as Post
        }
      />,
    )
    expect(screen.getByTestId("post-card-media-badge-photo")).toBeTruthy()
    expect(
      screen.getByTestId("post-card-media-badge-grouped").textContent,
    ).toContain("(4)")
    // The view count lives in the footer now (PostCardViews).
    expect(screen.queryByText("1.5K")).toBeNull()
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

describe("PostCardClampedBody", () => {
  /** happy-dom lays nothing out, so say the text runs past three lines. */
  function overflowing(run: () => void) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 200,
    })
    try {
      run()
    } finally {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    }
  }

  test("text that fits shows no More", () => {
    render(<PostCardClampedBody text="short" linkSpans={null} postSearch="" />)
    expect(screen.queryByText("More")).toBeNull()
  })

  test("text past three lines is clamped behind More, and Less clamps it again", () => {
    overflowing(() => {
      const { container } = render(
        <PostCardClampedBody text="long" linkSpans={null} postSearch="" />,
      )
      const clamp = () => container.querySelector("p")?.parentElement
      expect(clamp()?.className).toContain("max-h-[4.5em]")
      fireEvent.click(screen.getByText("More"))
      expect(clamp()?.className).not.toContain("max-h-[4.5em]")
      fireEvent.click(screen.getByText("Less"))
      expect(clamp()?.className).toContain("max-h-[4.5em]")
    })
  })
})

describe("PostCardView", () => {
  const full: Post = {
    ...post,
    viewsCount: 1500,
    media: { kinds: ["video"] },
    reactionCounts: [{ emoji: "👍", count: 3 }],
  }
  const renderCard = (extra: Partial<Parameters<typeof PostCardView>[0]>) =>
    render(
      <PostCardView
        post={full}
        channel={undefined}
        followsForwardSource={false}
        onAddChannel={() => {}}
        postSearch=""
        text={full.text}
        translation={{ showing: false, busy: false, onToggle: () => {} }}
        {...extra}
      />,
    )

  test("the card's footer carries views, reactions and every action, translate named", () => {
    renderCard({ onFindRelated: () => {} })
    const footer = document.querySelector("footer") as HTMLElement
    expect(footer.textContent).toContain("1.5K")
    expect(footer.textContent).toContain("👍3")
    expect(screen.getByLabelText("Translate").textContent).toBe("Translate")
    for (const label of ["Find Related Posts", "Copy Link", "Open in Telegram"])
      expect(footer.contains(screen.getByLabelText(label))).toBe(true)
    // Media badges sit with the body, the post id in the header.
    expect(
      footer.contains(screen.getByTestId("post-card-media-badge-video")),
    ).toBe(false)
    expect(footer.contains(screen.getByTestId("post-id-link-durov-42"))).toBe(
      false,
    )
  })

  test("a compact card moves the post id and badges into its footer and keeps icons only", () => {
    renderCard({ compact: true })
    const footer = document.querySelector("footer") as HTMLElement
    expect(footer.contains(screen.getByTestId("post-id-link-durov-42"))).toBe(
      true,
    )
    expect(
      footer.contains(screen.getByTestId("post-card-media-badge-video")),
    ).toBe(true)
    expect(screen.getByLabelText("Translate").textContent).toBe("")
  })

  test("the name, a followed forward source and the footer open the spotlight, the footer on f", () => {
    const shown: string[] = []
    renderCard({
      post: { ...full, forwardedFrom: "src", forwardedFromName: "Source" },
      followsForwardSource: true,
      onShowChannel: (name) => shown.push(name),
    })
    fireEvent.click(screen.getByTitle("Show only posts from durov"))
    fireEvent.click(screen.getByTitle("Show only posts from Source"))
    const action = screen.getByLabelText("Show this Channel")
    expect(action.dataset.shortcut).toBe("f")
    fireEvent.click(action)
    expect(shown).toEqual(["durov", "src", "durov"])
  })

  test("in its own Channel's spotlight, or with no spotlight to open, the card offers none", () => {
    renderCard({ onShowChannel: () => {}, spotlit: true })
    expect(screen.queryByLabelText("Show this Channel")).toBeNull()
    expect(screen.queryByTitle("Show only posts from durov")).toBeNull()
    cleanup()
    renderCard({
      post: { ...full, forwardedFrom: "src", forwardedFromName: "Source" },
      followsForwardSource: true,
    })
    expect(screen.queryByLabelText("Show this Channel")).toBeNull()
    expect(screen.queryByTitle("Show only posts from Source")).toBeNull()
  })

  test("the card is what Keyboard mode moves through", () => {
    const { container } = renderCard({})
    expect(
      container.querySelector('article[data-post-key="durov_42"]'),
    ).toBeTruthy()
  })
})
