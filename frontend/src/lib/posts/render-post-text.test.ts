import { describe, expect, test } from "bun:test"
import { isValidElement, type ReactElement } from "react"

import { renderPostText } from "@/lib/posts/render-post-text"

type AnchorProps = { href: string; "data-testid": string }

/** Collect the `<a>` elements produced for `@handle` mentions. */
function anchors(node: unknown): ReactElement<AnchorProps>[] {
  if (!Array.isArray(node)) return []
  return node.filter(
    (n): n is ReactElement<AnchorProps> => isValidElement(n) && n.type === "a",
  )
}

describe("renderPostText", () => {
  test("links a valid @mention to its Telegram web view", () => {
    const links = anchors(renderPostText("see @durov for news", ""))
    expect(links).toHaveLength(1)
    expect(links[0]?.props.href).toBe("https://t.me/s/durov")
    expect(links[0]?.props["data-testid"]).toBe("post-mention-link-durov")
  })

  test("links every mention in the post", () => {
    const links = anchors(renderPostText("@alpha_one and @bravo_two", ""))
    expect(links.map((a) => a.props.href)).toEqual([
      "https://t.me/s/alpha_one",
      "https://t.me/s/bravo_two",
    ])
  })

  test("does not link email locals or too-short handles", () => {
    expect(anchors(renderPostText("mail me user@gmail.com", ""))).toHaveLength(
      0,
    )
    expect(anchors(renderPostText("hi @ab", ""))).toHaveLength(0)
  })

  test("does not link reserved paths", () => {
    expect(anchors(renderPostText("visit @share now", ""))).toHaveLength(0)
  })

  test("returns the raw string when there is no text", () => {
    expect(renderPostText("", "")).toBe("")
  })
})
