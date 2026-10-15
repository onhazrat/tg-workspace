/**
 * A reply's parent as the reply link previews it: the whole Post when it is
 * stored, Telegram's excerpt when only that is, and a way to Telegram when
 * neither is.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type { Post } from "@/types"
import { PostCardHeader } from "./PostCardHeader"
import { ReplyParentCard, ReplyPreviewContext } from "./ReplyParent"

afterEach(cleanup)

const reply: Post = {
  id: 42,
  channelName: "durov",
  text: "the answer",
  date: "2026-10-07T09:00:00Z",
  timestamp: Date.UTC(2026, 9, 7, 9),
  replyToPostId: 7,
  replyTo: { text: "the quest…", url: "https://t.me/durov/7" },
}

const workspace = {
  sheet: false,
  channel: () => undefined,
  onAddChannel: () => {},
}

const card = (parent: Post | null, loading = false, post = reply) => {
  render(
    <ReplyParentCard
      reply={post}
      parent={parent}
      loading={loading}
      href="https://t.me/durov/7"
      workspace={workspace}
    />,
  )
  return screen.getByTestId("reply-parent-card")
}

describe("ReplyParentCard", () => {
  test("a stored parent shows whole, as a post card", () => {
    const long = `${Array(30).fill("line").join("\n")}\nthe whole question`
    const el = card({ ...reply, id: 7, text: long, replyToPostId: null })
    expect(within(el).getByText(/the whole question/)).toBeTruthy()
    expect(within(el).queryByText("Show More")).toBeNull()
    expect(within(el).queryByText(/excerpt/)).toBeNull()
  })

  test("a parent not stored shows Telegram's excerpt and says it is one", () => {
    const el = card(null)
    expect(within(el).getByText("the quest…")).toBeTruthy()
    expect(within(el).getByText(/excerpt/)).toBeTruthy()
    const open = within(el).getByRole("link", { name: /Open in Telegram/ })
    expect((open as HTMLAnchorElement).href).toBe("https://t.me/durov/7")
  })

  test("with no excerpt either, it says the post was not found", () => {
    const el = card(null, false, { ...reply, replyTo: null })
    expect(within(el).getByText(/not found/)).toBeTruthy()
    const open = within(el).getByRole("link", { name: /Open in Telegram/ })
    expect((open as HTMLAnchorElement).href).toContain("/durov/7")
  })

  test("while the lookup runs it shows neither the excerpt nor not-found", () => {
    const el = card(null, true)
    expect(within(el).getByLabelText("Loading post")).toBeTruthy()
    expect(within(el).queryByText("the quest…")).toBeNull()
  })
})

describe("the reply link", () => {
  // A private parent needs no lookup, so no request leaves the test.
  const privateReply: Post = {
    ...reply,
    replyTo: { text: "the quest…", url: "https://t.me/c/123/7" },
  }

  const header = (sheet: boolean | null) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReplyPreviewContext.Provider
          value={sheet == null ? null : { ...workspace, sheet }}
        >
          <PostCardHeader
            post={privateReply}
            channel={undefined}
            followsForwardSource={false}
            onAddChannel={() => {}}
            postSearch=""
          />
        </ReplyPreviewContext.Provider>
      </QueryClientProvider>,
    )

  test("hovering previews the parent and a click still goes to Telegram", async () => {
    header(false)
    const link = screen.getByTestId("post-reply-badge-durov-42")
    expect((link as HTMLAnchorElement).href).toBe("https://t.me/c/123/7")
    expect(link.getAttribute("title")).toBeNull()
    fireEvent.pointerEnter(link, { pointerType: "mouse" })
    fireEvent.mouseEnter(link)
    fireEvent.mouseMove(link)
    const card = await screen.findByTestId(
      "reply-parent-card",
      {},
      { timeout: 2000 },
    )
    expect(within(card).getByText(/excerpt/)).toBeTruthy()
  })

  test("with no hover, a tap opens the parent in a bottom sheet", async () => {
    header(true)
    fireEvent.click(screen.getByTestId("post-reply-badge-durov-42"))
    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByTestId("reply-parent-card")).toBeTruthy()
  })

  test("with no preview provided it is a plain link with the excerpt as its title", () => {
    header(null)
    const link = screen.getByTestId("post-reply-badge-durov-42")
    expect(link.tagName).toBe("A")
    expect(link.getAttribute("title")).toBe("the quest…")
  })
})
