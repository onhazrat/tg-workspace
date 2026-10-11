/**
 * Finding a Citation in the report (SUMTAB-04), as SUMTAB-05's "Find in
 * report" and SUMTAB-06's Find button use it: the first Citation of the Post
 * scrolls into view and is highlighted briefly, and a call made as a dialog
 * closes waits for the dialog to be gone, because its scroll lock outlives the
 * close and swallows a scroll started earlier.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  CITATION_ATTR,
  citationKey,
  FOUND_ATTR,
  findCitation,
} from "./find-citation"

afterEach(() => {
  document.body.innerHTML = ""
  document.body.removeAttribute("data-scroll-locked")
})

function report() {
  document.body.innerHTML = `
    <p>one <span ${CITATION_ATTR}="${citationKey("other", 3)}">x</span></p>
    <p>two <span id="first" ${CITATION_ATTR}="${citationKey("News_IR", 7)}">a</span>
    <span id="second" ${CITATION_ATTR}="${citationKey("news_ir", 7)}">b</span></p>`
  const scrolls: { id: string; options: unknown }[] = []
  for (const el of document.querySelectorAll<HTMLElement>("span"))
    el.scrollIntoView = mock((options) => scrolls.push({ id: el.id, options }))
  return scrolls
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("findCitation", () => {
  test("scrolls the first Citation of the Post into view, smoothly on a wide screen", async () => {
    const scrolls = report()
    expect(await findCitation("news_ir", 7, { narrow: false })).toBe(true)
    expect(scrolls).toEqual([
      { id: "first", options: { behavior: "smooth", block: "center" } },
    ])
  })

  test("jumps instantly on a narrow screen", async () => {
    const scrolls = report()
    await findCitation("NEWS_IR", 7, { narrow: true })
    expect(scrolls[0].options).toEqual({ behavior: "instant", block: "center" })
  })

  test("highlights the Citation briefly", async () => {
    report()
    await findCitation("news_ir", 7, { narrow: false, highlightMs: 20 })
    const first = document.getElementById("first") as HTMLElement
    expect(first.hasAttribute(FOUND_ATTR)).toBe(true)
    expect(document.getElementById("second")?.hasAttribute(FOUND_ATTR)).toBe(
      false,
    )
    await wait(40)
    expect(first.hasAttribute(FOUND_ATTR)).toBe(false)
  })

  test("a Post the report does not cite finds nothing", async () => {
    const scrolls = report()
    expect(await findCitation("news_ir", 8, { narrow: false })).toBe(false)
    expect(scrolls).toEqual([])
  })

  test("waits for a closing dialog and its scroll lock to be gone before scrolling", async () => {
    const scrolls = report()
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    document.body.append(dialog)
    document.body.setAttribute("data-scroll-locked", "1")

    const found = findCitation("news_ir", 7, { narrow: true })
    await wait(30)
    expect(scrolls).toEqual([])

    dialog.remove()
    await wait(30)
    expect(scrolls).toEqual([])

    document.body.removeAttribute("data-scroll-locked")
    expect(await found).toBe(true)
    expect(scrolls.map((s) => s.id)).toEqual(["first"])
  })
})
