import { describe, expect, test } from "bun:test"
import {
  createElement,
  Fragment,
  isValidElement,
  type ReactElement,
} from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { env } from "@/lib/env"
import { renderPostText } from "@/lib/posts/render-post-text"

type AnchorProps = {
  href: string
  "data-testid": string
  target?: string
  rel?: string
  title?: string
  children?: unknown
  onClick?: (e: unknown) => void
}

/** Collect the `<a>` elements the renderer produced. */
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

describe("renderPostText with stored Links (LINK-01)", () => {
  test("a stored Link renders over its own words and opens in a new tab", () => {
    const links = anchors(
      renderPostText("Read the docs now", "", [
        { offset: 5, length: 8, url: "https://example.com/a" },
      ]),
    )

    expect(links).toHaveLength(1)
    expect(links[0]?.props.href).toBe("https://example.com/a")
    expect(links[0]?.props.children).toBe("the docs")
    expect(links[0]?.props.target).toBe("_blank")
    expect(links[0]?.props.rel).toBe("noopener noreferrer")
  })

  test("a masked Link shows where it really goes on hover", () => {
    const [masked, bare] = anchors(
      renderPostText("google.com or https://example.com/", "", [
        { offset: 0, length: 10, url: "https://evil.example/login" },
        { offset: 14, length: 20, url: "https://example.com/" },
      ]),
    )

    expect(masked?.props.title).toBe("https://evil.example/login")
    expect(bare?.props.title).toBeUndefined()
  })

  test("clicking a Link does not reach the card it sits in", () => {
    const [link] = anchors(
      renderPostText("go", "", [
        { offset: 0, length: 2, url: "https://example.com/" },
      ]),
    )
    let stopped = false
    link?.props.onClick?.({
      stopPropagation: () => {
        stopped = true
      },
    })

    expect(stopped).toBe(true)
  })
})

describe("renderPostText and what a stored Link may open", () => {
  test("an empty list is an answer, so nothing is guessed from the words", () => {
    expect(
      anchors(renderPostText("@durov at https://example.com/", "", [])),
    ).toEqual([])
  })

  test("only http, https and mailto become anchors", () => {
    const text = "Subscribe mail back"
    const links = anchors(
      renderPostText(text, "", [
        { offset: 0, length: 9, url: "tg://premium_offer?ref=premium" },
        { offset: 10, length: 4, url: "mailto:someone@example.com" },
        { offset: 15, length: 4, url: "?q=%23tag" },
      ]),
    )

    expect(links.map((a) => a.props.href)).toEqual([
      "mailto:someone@example.com",
    ])
    expect(links[0]?.props.target).toBe("_blank")
  })

  test("Telegram links follow the configured web view and mirror", () => {
    const settings = env as unknown as { telegramWebDomain: string }
    const configured = settings.telegramWebDomain
    settings.telegramWebDomain = "telegram.me"
    try {
      const text = "@durov post theme"
      const links = anchors(
        renderPostText(text, "", [
          { offset: 0, length: 6, url: "https://t.me/durov" },
          { offset: 7, length: 4, url: "https://t.me/durov/510" },
          { offset: 12, length: 5, url: "https://t.me/addtheme/RetroGreen" },
        ]),
      )

      expect(links.map((a) => a.props.href)).toEqual([
        "https://telegram.me/s/durov",
        "https://telegram.me/s/durov/510",
        "https://telegram.me/addtheme/RetroGreen",
      ])
      expect(links[0]?.props["data-testid"]).toBe("post-mention-link-durov")
    } finally {
      settings.telegramWebDomain = configured
    }
  })

  test("a search highlight still marks words inside a Link", () => {
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        renderPostText("Read the docs now", "docs", [
          { offset: 5, length: 8, url: "https://example.com/a" },
        ]),
      ),
    )

    expect(html).toContain(
      '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer"',
    )
    expect(html).toMatch(/<a [^>]*>the <mark[^>]*>docs<\/mark><\/a>/)
  })

  test("positions count UTF-16 units, so an emoji before a Link shifts it by two", () => {
    const [link] = anchors(
      renderPostText("\u{1F525} go", "", [
        { offset: 3, length: 2, url: "https://example.com/" },
      ]),
    )

    expect(link?.props.children).toBe("go")
  })
})

describe("renderPostText without stored Links", () => {
  test("links bare addresses and trims the sentence's punctuation", () => {
    const links = anchors(
      renderPostText("See https://example.com/a?b=1, then http://x.org.", ""),
    )

    expect(links.map((a) => a.props.href)).toEqual([
      "https://example.com/a?b=1",
      "http://x.org",
    ])
    expect(links.every((a) => a.props.target === "_blank")).toBe(true)
  })

  test("links a scheme-less t.me path to the web view", () => {
    const links = anchors(renderPostText("join t.me/durov today", ""))

    expect(links.map((a) => a.props.href)).toEqual(["https://t.me/s/durov"])
    expect(links[0]?.props.children).toBe("t.me/durov")
  })

  test("does not guess at bare domains", () => {
    expect(anchors(renderPostText("open file.txt or e.g. x.org", ""))).toEqual(
      [],
    )
  })
})
