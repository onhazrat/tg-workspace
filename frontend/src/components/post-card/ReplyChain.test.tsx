/**
 * The Reply chain's key routing (RCH-02), on the feed's keyboard adapter with
 * the real chain hook: `[` on a Post that is not a reply says so and opens
 * nothing, `[` on a reply opens its chain with the Highlight on the parent,
 * `[` while open is taken and does nothing, and `]` closes the chain and puts
 * the feed's Highlight back on the Post it started from. The chain read is
 * seeded in the query cache, so nothing is fetched.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Toaster } from "sonner"
import { KeyboardMode } from "@/components/keyboard/KeyboardMode"
import { keydowns } from "@/lib/keyboard/keydowns"
import { lastHighlight, setKeyboardMode } from "@/lib/keyboard/mode"
import { chainQuery, type PostsView } from "@/lib/posts/posts-view"
import type { Post } from "@/types"
import { postCardKey, usePostKeys } from "./FeedKeyboard"
import { panelItem, useReplyChain } from "./ReplyChain"

const OPS = {
  go: () => {},
  step: () => {},
  goToNth: () => {},
  close: () => {},
  reopen: () => {},
}

const post = (id: number, replyToPostId: number | null = null): Post =>
  ({
    id,
    channelName: "ch",
    text: `post ${id}`,
    date: "",
    timestamp: id,
    replyToPostId,
  }) as Post

const TOP = post(1)
const MIDDLE = post(2, 1)
const REPLY = post(3, 2)
/** A later Post of Album #4: only the Album's first Post holds its reply. */
const PHOTO = { ...post(5), albumId: 4 } as Post
const FEED = [TOP, REPLY, PHOTO]

const VIEW = {
  scopeChannelNames: ["ch"],
  windowKey: { mode: "fixed", start: 0, end: 10 },
  selectionRevision: 0,
  startDate: 0,
  endDate: 10,
  selection: [],
} as unknown as PostsView

/** Every Post `[` asked to open a chain from. */
let opened: string[] = []

function Feed() {
  const chain = useReplyChain(VIEW, "feed")
  const items = chain.items?.map((i) => i.key) ?? null
  const { highlight } = usePostKeys({
    keys: FEED.map(postCardKey),
    onCompact: () => {},
    spotlit: false,
    onSpotlightBack: () => {},
    // A held Post: `.` shows it.
    onShowNew: () => "ch_9",
    chain: {
      items,
      ring: chain.ring,
      start: chain.start,
      element: panelItem,
      reveal: () => {},
      open: (key) => {
        opened.push(key)
        const reply = FEED.find((p) => postCardKey(p) === key)
        if (reply) chain.open(reply)
      },
      close: chain.close,
    },
  })
  return (
    <>
      <KeyboardMode ops={OPS} />
      <Toaster />
      <button type="button" onClick={() => chain.open(REPLY)}>
        Reply to #2
      </button>
      {FEED.map((p) => (
        <article
          key={p.id}
          data-post-key={postCardKey(p)}
          data-highlight={(!items && highlight === postCardKey(p)) || undefined}
        />
      ))}
      {items && (
        <aside aria-label="Reply chain">
          {items.map((key) => (
            <div
              key={key}
              data-chain-key={key}
              data-chain-highlight={highlight === key || undefined}
            />
          ))}
        </aside>
      )}
    </>
  )
}

let client: QueryClient
const mount = () =>
  render(
    <QueryClientProvider client={client}>
      <Feed />
    </QueryClientProvider>,
  )
const type = (...keys: string[]) => {
  for (const init of keydowns(...keys))
    fireEvent.keyDown(document.activeElement ?? document.body, init)
}
const feedHighlight = () =>
  document
    .querySelector("article[data-highlight]")
    ?.getAttribute("data-post-key")
const chainHighlight = () =>
  document
    .querySelector("[data-chain-highlight]")
    ?.getAttribute("data-chain-key")
const chainKeys = () =>
  Array.from(document.querySelectorAll("[data-chain-key]")).map((el) =>
    el.getAttribute("data-chain-key"),
  )

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  })
  client.setQueryData(chainQuery(VIEW, REPLY).queryKey, {
    posts: [REPLY, MIDDLE, TOP],
    stop: "notReply" as const,
  })
  // The route's copy of the photo carries its Album's reply.
  client.setQueryData(chainQuery(VIEW, PHOTO).queryKey, {
    posts: [{ ...PHOTO, replyToPostId: 2 }, MIDDLE, TOP],
    stop: "notReply" as const,
  })
  lastHighlight.clear()
  opened = []
  setKeyboardMode(true)
})
afterEach(() => {
  cleanup()
  setKeyboardMode(false)
})

describe("the Reply chain's keys", () => {
  test("[ on a Post that is not a reply says so and opens nothing", async () => {
    mount()
    type("j", "[")
    expect(await screen.findByText("That post is not a reply")).toBeTruthy()
    expect(chainKeys()).toEqual([])
    expect(feedHighlight()).toBe("ch_1")
  })

  test("[ opens the whole chain on the parent; [ again does nothing; ] goes back", async () => {
    mount()
    type("j", "j", "[")
    await act(async () => {})
    expect(chainKeys()).toEqual(["ch_1", "ch_2", "ch_3"])
    expect(chainHighlight()).toBe("ch_2")
    type("k", "[")
    expect(opened).toEqual(["ch_3"])
    expect(chainKeys()).toEqual(["ch_1", "ch_2", "ch_3"])
    expect(chainHighlight()).toBe("ch_1")
    type("]")
    await act(async () => {})
    expect(chainKeys()).toEqual([])
    expect(feedHighlight()).toBe("ch_3")
  })

  test("] after a click opened the chain puts the feed's Highlight on the reply", async () => {
    mount()
    type("j")
    expect(feedHighlight()).toBe("ch_1")
    fireEvent.click(screen.getByRole("button", { name: "Reply to #2" }))
    await act(async () => {})
    expect(chainKeys()).toEqual(["ch_1", "ch_2", "ch_3"])
    type("]")
    await act(async () => {})
    expect(feedHighlight()).toBe("ch_3")
  })

  test("[ on a later Album Post opens on the parent its Album answers", async () => {
    mount()
    type("G", "[")
    await act(async () => {})
    expect(chainKeys()).toEqual(["ch_1", "ch_2", "ch_5"])
    expect(chainHighlight()).toBe("ch_2")
  })

  test(". in the chain shows the held Posts and leaves the Highlight in the chain", async () => {
    mount()
    type("j", "j", "[")
    await act(async () => {})
    type(".")
    expect(chainHighlight()).toBe("ch_2")
  })
})
