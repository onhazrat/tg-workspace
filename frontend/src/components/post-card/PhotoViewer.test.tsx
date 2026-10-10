/**
 * The photo viewer (PTR-02): a gallery over every photo the feed has loaded,
 * each step starting whole, and three ways out that leave the feed at the Post
 * of the last photo viewed. The zoom and pan arithmetic is pinned in
 * `photo-viewer-model.test.ts`; this pins the behaviour around it.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PhotoViewer, PhotoViewerDialog, REVEAL_CHANNEL } from "./PhotoViewer"

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
const photo = () => stage().querySelector("img") as HTMLImageElement
/** A mouse click: a pointer that goes down and up without moving. */
const click = (x = 0, y = 0) => {
  fireEvent.pointerDown(stage(), { clientX: x, clientY: y })
  fireEvent.pointerUp(stage(), { clientX: x, clientY: y })
}
/** One finger's pointer event, as a phone sends it. */
const finger = (
  phase: "down" | "move" | "up",
  id: number,
  x: number,
  y: number,
) =>
  ({
    down: fireEvent.pointerDown,
    move: fireEvent.pointerMove,
    up: fireEvent.pointerUp,
  })[phase](stage(), {
    pointerId: id,
    pointerType: "touch",
    clientX: x,
    clientY: y,
  })
const tap = (x = 500, y = 500) => {
  finger("down", 1, x, y)
  finger("up", 1, x, y)
}
/** A one-finger swipe by (dx, dy) from the middle of the screen. */
const swipe = (dx: number, dy: number) => {
  finger("down", 1, 500, 500)
  finger("move", 1, 500 + dx, 500 + dy)
  finger("up", 1, 500 + dx, 500 + dy)
}
/**
 * Give the viewer a size, since happy-dom lays nothing out: a 1000x1000
 * screen at the origin and a 2000x500 photo, drawn 1000x250 at 1x.
 */
const sized = () => {
  Object.defineProperty(photo(), "naturalWidth", { value: 2000 })
  Object.defineProperty(photo(), "naturalHeight", { value: 500 })
  stage().getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
}

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
    // The viewer reads the two clicks itself; a dblclick event changes nothing.
    click()
    click()
    fireEvent.doubleClick(stage())
    expect(label()).toContain("2.5x")
    expect(label()).toContain("double-click to reset")
    await act(() => sleep(300))
    expect(onClose).not.toHaveBeenCalled()

    click()
    click()
    expect(label()).not.toContain("x ·")
    expect(label()).toContain("scroll or double-click to zoom")
  })

  test("a click at 1x closes, after the beat a double-click would need", async () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:a" onClose={onClose} />)
    click()
    expect(onClose).not.toHaveBeenCalled()
    await act(() => sleep(300))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test("a click on a zoomed photo does not close it", async () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:a" onClose={onClose} />)
    fireEvent.wheel(stage(), { deltaY: -300 })
    click()
    await act(() => sleep(300))
    expect(onClose).not.toHaveBeenCalled()
  })

  test("a pinch scales about the fingers' midpoint and does not close", async () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:a" onClose={onClose} />)
    sized()
    // 100px apart, about a point 200px right of the centre.
    finger("down", 1, 650, 500)
    finger("down", 2, 750, 500)
    finger("move", 2, 850, 500)
    // Twice as far apart: 2x, with that point held still.
    expect(photo().style.transform).toBe("translate(-200px, 0px) scale(2)")
    expect(label()).toContain("2.0x")
    expect(label()).toContain("double-tap to reset")

    // One finger lifts and the other carries on as a pan, without a jump.
    finger("up", 2, 850, 500)
    finger("move", 1, 600, 500)
    expect(photo().style.transform).toBe("translate(-250px, 0px) scale(2)")
    finger("up", 1, 600, 500)
    await act(() => sleep(300))
    expect(onClose).not.toHaveBeenCalled()
    expect(label()).toContain("2.0x")
  })

  test("what is left of a pinch is never a swipe, even back at 1x", () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:b" onClose={onClose} />)
    finger("down", 1, 400, 500)
    finger("down", 2, 600, 500)
    finger("move", 2, 450, 500)
    finger("up", 2, 450, 500)
    finger("move", 1, 100, 520)
    finger("up", 1, 100, 520)
    expect(label()).toContain("Chan b · 2 / 3")
    expect(onClose).not.toHaveBeenCalled()
  })

  test("a double-tap toggles 2.5x about the tap and does not close", async () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:a" onClose={onClose} />)
    sized()
    tap(700, 500)
    tap(700, 505)
    expect(photo().style.transform).toBe("translate(-300px, 0px) scale(2.5)")
    await act(() => sleep(300))
    expect(onClose).not.toHaveBeenCalled()
    expect(label()).toContain("2.5x")

    tap()
    tap()
    expect(label()).not.toContain("x ·")
    expect(label()).toContain("pinch or double-tap to zoom")
  })

  test("a touch tap shows or hides the controls and does not close", async () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:b" onClose={onClose} />)
    tap()
    await act(() => sleep(300))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByTestId("photo-viewer-label")).toBeNull()
    expect(screen.queryByLabelText("Next photo")).toBeNull()

    tap()
    await act(() => sleep(300))
    expect(label()).toContain("Chan b")
    expect(screen.getByLabelText("Next photo")).toBeTruthy()
  })

  test("at 1x a swipe left steps forward, right steps back, down closes", () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:b" onClose={onClose} />)
    swipe(-200, 10)
    expect(label()).toContain("Chan c · 3 / 3")
    swipe(200, -10)
    swipe(200, -10)
    expect(label()).toContain("Chan a · 1 / 3")
    expect(onClose).not.toHaveBeenCalled()

    // A mouse drag is not a swipe.
    fireEvent.pointerDown(stage(), { clientX: 500, clientY: 500 })
    fireEvent.pointerMove(stage(), { clientX: 200, clientY: 500 })
    fireEvent.pointerUp(stage(), { clientX: 200, clientY: 500 })
    expect(label()).toContain("Chan a · 1 / 3")

    swipe(20, 200)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test("in a right-to-left page a swipe left steps back", () => {
    document.getElementById("feed")?.setAttribute("dir", "rtl")
    render(<PhotoViewer start="blob:b" onClose={() => {}} />)
    swipe(-200, 10)
    expect(label()).toContain("Chan a · 1 / 3")
    swipe(200, 10)
    expect(label()).toContain("Chan b · 2 / 3")
  })

  test("above 1x one finger pans the photo and neither steps nor closes", () => {
    const onClose = mock()
    render(<PhotoViewer start="blob:b" onClose={onClose} />)
    sized()
    tap()
    tap()
    swipe(-200, 10)
    expect(photo().style.transform).toBe("translate(-200px, 0px) scale(2.5)")
    swipe(0, 200)
    expect(label()).toContain("Chan b · 2 / 3")
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

test("a Channel card that unmounted while open is revealed by the grid instead", () => {
  const grid = document.createElement("div")
  grid.innerHTML = `<div data-channel-name="durov"><img src="blob:d" data-gallery-caption="Pavel"></div>`
  document.body.appendChild(grid)
  const tile = grid.firstElementChild as HTMLElement
  tile.scrollIntoView = mock()
  const revealed: unknown[] = []
  const onReveal = (e: Event) => revealed.push((e as CustomEvent).detail)
  window.addEventListener(REVEAL_CHANNEL, onReveal)
  try {
    const { unmount } = render(
      <PhotoViewer start="blob:d" onClose={() => {}} />,
    )
    // The virtualised grid drops the card, say after a resize or a re-sort.
    grid.remove()
    unmount()
  } finally {
    window.removeEventListener(REVEAL_CHANNEL, onReveal)
  }
  expect(tile.scrollIntoView).not.toHaveBeenCalled()
  expect(revealed).toEqual(["durov"])
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
