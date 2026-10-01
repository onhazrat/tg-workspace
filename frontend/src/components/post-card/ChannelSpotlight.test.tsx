/**
 * The Channel spotlight's banner (PTR-04): it names the Channel and what it
 * shows, keeps the filters on request, and leads back by its button or
 * Escape. Escape while the photo viewer is open closes the viewer only.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react"
import { useState } from "react"
import { addPostFunnel, emptyPostFilter } from "@/lib/posts/post-filter"
import type { Post } from "@/types"
import { SpotlightBanner, useSpotlightState } from "./ChannelSpotlight"
import { PhotoViewerDialog } from "./PhotoViewer"

afterEach(cleanup)

function mount(calls: [string, unknown][], keepFilters = false) {
  render(
    <SpotlightBanner
      name="durov"
      channel={undefined}
      keepFilters={keepFilters}
      onKeepFiltersChange={(keep) => calls.push(["keep", keep])}
      onBack={() => calls.push(["back", undefined])}
    />,
  )
}

const banner = () => screen.getByTestId("channel-spotlight").textContent ?? ""

describe("SpotlightBanner", () => {
  test("names the Channel, says it shows everything, and keeps the filters on request", () => {
    const calls: [string, unknown][] = []
    mount(calls)
    expect(banner()).toContain("Only @durov · every post in this window")
    expect(
      screen.getByRole("link", { name: "@durov" }).getAttribute("href"),
    ).toContain("durov")
    fireEvent.click(screen.getByLabelText("Keep my filters"))
    expect(calls).toEqual([["keep", true]])
    cleanup()
    mount(calls, true)
    expect(banner()).toContain("with your filters")
  })

  test("Back to feed and Escape lead back", () => {
    const calls: [string, unknown][] = []
    mount(calls)
    fireEvent.click(screen.getByRole("button", { name: /Back to feed/ }))
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(calls).toEqual([
      ["back", undefined],
      ["back", undefined],
    ])
  })

  test("Escape after ticking Keep my filters still leads back", () => {
    const calls: [string, unknown][] = []
    mount(calls)
    const box = screen.getByLabelText("Keep my filters")
    box.focus()
    fireEvent.keyDown(box, { key: "Escape" })
    expect(calls).toEqual([["back", undefined]])
  })

  test("Escape in a field being typed in stays there", () => {
    const calls: [string, unknown][] = []
    render(<input aria-label="Keyword search" />)
    mount(calls)
    const box = screen.getByLabelText("Keyword search")
    box.focus()
    fireEvent.keyDown(box, { key: "Escape" })
    expect(calls).toEqual([])
  })

  test("Escape with the photo viewer open closes the viewer only", () => {
    const calls: [string, unknown][] = []
    function Viewer() {
      const [open, setOpen] = useState(true)
      return (
        <PhotoViewerDialog start="blob:a" open={open} onOpenChange={setOpen} />
      )
    }
    render(<Viewer />)
    mount(calls)
    expect(screen.getByRole("dialog")).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(calls).toEqual([])
    // With the viewer gone, the next Escape is the spotlight's.
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(calls).toEqual([["back", undefined]])
  })
})

describe("useSpotlightState", () => {
  const filter = addPostFunnel(emptyPostFilter(), "language", "fa")
  const post = { id: 7, channelName: "durov" } as Post
  const frame = () => new Promise((r) => requestAnimationFrame(r))

  function setup(card: boolean) {
    const container = document.createElement("div")
    const scrolled: unknown[] = []
    container.scrollTo = ((to: unknown) => scrolled.push(to)) as never
    container.scrollTop = 900
    const into: unknown[] = []
    if (card) {
      const article = document.createElement("article")
      article.dataset.postKey = "durov_7"
      article.scrollIntoView = ((to: unknown) => into.push(to)) as never
      container.appendChild(article)
    }
    document.body.appendChild(container)
    const hook = renderHook(
      ({ searching }) =>
        useSpotlightState({ current: container }, filter, searching),
      { initialProps: { searching: false } },
    )
    return { hook, scrolled, into, container }
  }

  test("leaving scrolls back to the card it started from", async () => {
    const { hook, scrolled, into, container } = setup(true)
    act(() => hook.result.current.enter?.(post, "durov"))
    expect(hook.result.current.spotlight?.channel).toBe("durov")
    expect(scrolled).toEqual([{ top: 0 }])
    act(() => hook.result.current.leave())
    await act(frame)
    expect(hook.result.current.spotlight).toBeNull()
    expect(into).toEqual([{ block: "center" }])
    container.remove()
  })

  test("with the card gone, back to the scroll position", async () => {
    const { hook, scrolled, container } = setup(false)
    act(() => hook.result.current.enter?.(post, "durov"))
    act(() => hook.result.current.leave())
    await act(frame)
    expect(scrolled).toEqual([{ top: 0 }, { top: 900 }])
    container.remove()
  })

  test("a meaning or related search leaves it, with no scroll back", async () => {
    const { hook, scrolled, container } = setup(false)
    act(() => hook.result.current.enter?.(post, "durov"))
    hook.rerender({ searching: true })
    await act(frame)
    expect(hook.result.current.spotlight).toBeNull()
    expect(scrolled).toEqual([{ top: 0 }])
    container.remove()
  })
})
