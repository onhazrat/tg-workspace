/**
 * [ climbs a reply chain: onto the parent's card when the feed shows it, into
 * the panel when not, and on up in the panel; ] retraces each step.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { KeyboardMode } from "@/components/keyboard/KeyboardMode"
import { queryKeys } from "@/hooks/queryKeys"
import { keydowns } from "@/lib/keyboard/keydowns"
import { lastHighlight, setKeyboardMode } from "@/lib/keyboard/mode"
import type { Post } from "@/types"
import { postCardKey, usePostKeys } from "./FeedKeyboard"
import { replyUp, useReplyChain } from "./ReplyChain"

const post = (id: number, replyToPostId: number | null = null) =>
  ({ channelName: "ch", id, replyToPostId, text: "" }) as Post

// 1 answers 3, which the feed shows; 3 answers 99, which it does not.
const POSTS = [post(1, 3), post(2), post(3, 99)]

const OPS = {
  go: () => {},
  step: () => {},
  goToNth: () => {},
  close: () => {},
  reopen: () => {},
}

function Feed() {
  const chain = useReplyChain(POSTS)
  const highlight = usePostKeys({
    keys: POSTS.map(postCardKey),
    onCompact: () => {},
    spotlit: false,
    onSpotlightBack: () => {},
    chain,
  })
  return (
    <>
      <KeyboardMode ops={OPS} />
      <output data-testid="panel">
        {chain.steps
          .filter((s) => !s.inFeed)
          .map((s) => s.from.id)
          .join(",")}
      </output>
      {POSTS.map((p) => (
        <article
          key={p.id}
          data-post-key={postCardKey(p)}
          data-highlight={highlight === postCardKey(p) || undefined}
        />
      ))}
    </>
  )
}

const highlighted = () =>
  document.querySelector("[data-highlight]")?.getAttribute("data-post-key")
const panel = () => screen.getByTestId("panel").textContent
const type = (...keys: string[]) => {
  for (const init of keydowns(...keys)) fireEvent.keyDown(document.body, init)
}

beforeEach(() => {
  lastHighlight.clear()
  setKeyboardMode(true)
})
afterEach(() => {
  cleanup()
  setKeyboardMode(false)
})

describe("the reply chain", () => {
  test("[ goes up through the feed, then the panel; ] comes back", () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.replyParent("ch", 99), post(99, 50))
    render(
      <QueryClientProvider client={client}>
        <Feed />
      </QueryClientProvider>,
    )
    type("j", "[")
    expect(highlighted()).toBe("ch_3")
    type("[")
    expect(panel()).toBe("3")
    type("[")
    expect(panel()).toBe("3,99")
    expect(highlighted()).toBe("ch_3")
    type("]", "]")
    expect(panel()).toBe("")
    type("]")
    expect(highlighted()).toBe("ch_1")
  })

  test("a move leaves the chain", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Feed />
      </QueryClientProvider>,
    )
    type("G", "[")
    expect(panel()).toBe("3")
    type("k")
    expect(panel()).toBe("")
  })

  test("replyUp refuses a Post that is no reply, still loading or not stored", () => {
    const none = () => undefined
    expect(replyUp(post(2), none, false)).toEqual({
      refused: "That post is not a reply",
    })
    expect("refused" in replyUp(undefined, none, false)).toBe(true)
    expect("refused" in replyUp(null, none, false)).toBe(true)
    // Once in the panel, a parent the feed shows still opens there.
    expect(replyUp(post(1, 3), () => "ch_3", true)).toEqual({ to: "panel" })
  })
})
