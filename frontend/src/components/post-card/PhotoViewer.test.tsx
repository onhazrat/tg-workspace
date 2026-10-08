/**
 * The photo viewer (PTR-02): a gallery over every photo the feed has loaded,
 * each step starting whole, and three ways out that leave the feed at the Post
 * of the last photo viewed. The zoom and pan arithmetic is pinned in
 * `photo-viewer-model.test.ts`; this pins the behaviour around it.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PhotoViewer, PhotoViewerDialog } from "./PhotoViewer"

/** Three cards on the page, as the feed draws them. */
function feed() {
  const root = document.createElement("div")
  root.id = "feed"
  root.innerHTML = ["a", "b", "c"]
    .map(
      (id) =>
        `<article data-post-key="ch_${id}"><img src="blob:${id}" data-gallery-caption="Chan ${id}"></article>`,
    )
    .join("")
  document.body.appendChild(root)
  return root
}

const card = (id: string) =>
  document.querySelector(`[data-post-key="ch_${id}"]`) as HTMLElement
const label = () => screen.getByTestId("photo-viewer-label").textContent ?? ""
const stage = () => screen.getByTestId("photo-viewer")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  feed()
})
afterEach(() => {
  cleanup()
  document.getElementById("feed")?.remove()
})

describe("PhotoViewer", () => {
  test("names the Channel and where the photo sits in the feed", () => {
    render(<PhotoViewer start="blob:b" onClose={() => {}} />)
    expect(label()).toContain("Chan b · 2 / 3")
  })

  test("arrows and side buttons step through the feed, each photo starting whole", () => {
    render(<PhotoViewer start="blob:b" onClose={() => {}} />)
    fireEvent.wheel(stage(), { deltaY: -300 })
    expect(label()).toContain("3.3x")

    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(label()).toContain("Chan c · 3 / 3")
    expect(label()).not.toContain("x ·")
    expect(
      (screen.getByLabelText("Next photo") as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.click(screen.getByLabelText("Previous photo"))
    fireEvent.keyDown(window, { key: "ArrowLeft" })
    expect(label()).toContain("Chan a · 1 / 3")
    expect(
      (screen.getByLabelText("Previous photo") as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  test("a double-click toggles 2.5x and cancels the click that would close", async () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:a" onClose={onClose} />)
    // A browser sends both clicks of a double-click before the dblclick.
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(stage(), { clientX: 0, clientY: 0 })
      fireEvent.pointerUp(stage())
    }
    fireEvent.doubleClick(stage())
    expect(label()).toContain("2.5x")
    await act(() => sleep(300))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.doubleClick(stage())
    expect(label()).not.toContain("x ·")
  })

  test("a click at 1x closes, after the beat a double-click would need", async () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:a" onClose={onClose} />)
    fireEvent.pointerDown(stage(), { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(stage())
    expect(onClose).not.toHaveBeenCalled()
    await act(() => sleep(300))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test("a click on a zoomed photo does not close it", async () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:a" onClose={onClose} />)
    fireEvent.wheel(stage(), { deltaY: -300 })
    fireEvent.pointerDown(stage(), { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(stage())
    await act(() => sleep(300))
    expect(onClose).not.toHaveBeenCalled()
  })

  test("closing leaves the feed at the Post of the last photo viewed", () => {
    const scrolled = mock()
    card("c").scrollIntoView = scrolled
    card("a").scrollIntoView = mock()
    const { unmount } = render(
      <PhotoViewer start="blob:a" onClose={() => {}} />,
    )
    fireEvent.keyDown(window, { key: "ArrowRight" })
    fireEvent.keyDown(window, { key: "ArrowRight" })
    unmount()
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(card("a").scrollIntoView).not.toHaveBeenCalled()
  })
})

test("closing leaves the Channels grid at the Channel of the last photo viewed", () => {
  const grid = document.createElement("div")
  grid.id = "grid"
  grid.innerHTML = `<div data-channel-name="durov"><img src="blob:d" data-gallery-caption="Pavel"></div>`
  document.body.appendChild(grid)
  const tile = grid.firstElementChild as HTMLElement
  tile.scrollIntoView = mock()
  const { unmount } = render(<PhotoViewer start="blob:c" onClose={() => {}} />)
  fireEvent.keyDown(window, { key: "ArrowRight" })
  expect(label()).toContain("Pavel · 4 / 4")
  unmount()
  grid.remove()
  expect(tile.scrollIntoView).toHaveBeenCalledTimes(1)
})

describe("PhotoViewerDialog", () => {
  test("Escape and the close button both close it", () => {
    const onOpenChange = mock()
    render(
      <PhotoViewerDialog start="blob:a" open onOpenChange={onOpenChange} />,
    )
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    })
    expect(onOpenChange).toHaveBeenLastCalledWith(false)

    onOpenChange.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })
})
