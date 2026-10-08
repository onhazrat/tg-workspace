/**
 * A Channel's photo and its Telegram link at every card size (CARD-04). The
 * photo opens the Posts tab's viewer: on cards and compact cards the photo is
 * the button, on a tile a magnifier is, because the tile's body selects.
 * "Open in Telegram" is at the photo's corner at every size.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  type CardFieldSettings,
  type CardZoom,
  cardFace,
} from "@/lib/channels/card-zoom"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import type { Channel } from "@/types"
import { ChannelCardFace } from "./ChannelCardFace"
import { ChannelCardTile } from "./ChannelCardTile"

afterEach(cleanup)

const noop = () => {}
const settingsOff: CardFieldSettings = {
  showChannelBio: false,
  showChannelSubscribers: false,
  showChannelTelegramChatId: false,
  showChannelPhotos: false,
  showChannelVideos: false,
  showChannelFiles: false,
  showChannelLinks: false,
  showChannelStartId: false,
}
const pavel: Channel = {
  id: "c1",
  name: "durov",
  displayName: "Pavel",
  photoUrl: "https://example.test/durov.jpg",
  tags: [],
}
const noPhoto: Channel = { ...pavel, photoUrl: undefined }

function renderAt(zoom: CardZoom, channel: Channel = pavel) {
  const onToggleSelected = mock()
  if (zoom === -2) {
    render(
      <ChannelCardTile
        channel={channel}
        isSelected={false}
        isScraping={false}
        busy={false}
        onToggleSelected={onToggleSelected}
        onSync={noop}
      />,
    )
    return onToggleSelected
  }
  render(
    <ChannelCardFace
      channel={channel}
      stats={undefined}
      face={cardFace(zoom, settingsOff)}
      inScopeCount={0}
      accountChannels={[]}
      onFilterByTag={noop}
      isSelected={false}
      isScraping={false}
      busy={false}
      queuePosition={null}
      onToggleSelected={onToggleSelected}
      onToggleFreeze={noop}
      onResetAndSync={noop}
      onRemove={noop}
      onSaveChannel={noop}
      onSync={noop}
    />,
  )
  return onToggleSelected
}

const photoButton = () =>
  screen.findByRole("button", { name: "View Pavel's photo" })
const viewer = () => screen.queryByRole("dialog", { name: "Channel photo" })

describe("the photo opens the viewer", () => {
  test.each([
    [-1, "compact card"],
    [0, "card"],
    [1, "detailed card"],
    [-2, "tile"],
  ] as const)("at zoom %d (%s), without selecting", async (zoom) => {
    const onToggleSelected = renderAt(zoom)
    expect(viewer()).toBeNull()
    fireEvent.click(await photoButton())
    expect(viewer()).toBeTruthy()
    expect(onToggleSelected).not.toHaveBeenCalled()
  })
})

const ZOOMS: CardZoom[] = [-2, -1, 0, 1]

test("the photo joins the viewer's gallery under the Channel's title", async () => {
  renderAt(0)
  await photoButton()
  expect(
    document
      .querySelector("img[data-gallery-caption]")
      ?.getAttribute("data-gallery-caption"),
  ).toBe("Pavel")
})

describe("a tile", () => {
  test("still selects when clicked anywhere but the magnifier", async () => {
    const onToggleSelected = renderAt(-2)
    expect((await photoButton()).className).toContain("-left-1")
    fireEvent.click(screen.getByRole("button", { name: "Select durov" }))
    expect(onToggleSelected).toHaveBeenCalledTimes(1)
    expect(viewer()).toBeNull()
  })

  test("with no photo has no magnifier", async () => {
    renderAt(-2, noPhoto)
    await act(() => Promise.resolve())
    expect(screen.queryByRole("button", { name: /photo/ })).toBeNull()
    expect(screen.getByText("P")).toBeTruthy()
  })

  test("names the Channel in the app's tooltip, not the native one", async () => {
    renderAt(-2)
    const frame = document.querySelector("[data-channel-name]") as HTMLElement
    expect(frame.closest("[title]")).toBeNull()
    expect(screen.queryByText("@durov")).toBeNull()
    fireEvent.pointerEnter(frame, { pointerType: "mouse" })
    fireEvent.mouseEnter(frame)
    fireEvent.mouseMove(frame)
    expect(await screen.findByText("@durov")).toBeTruthy()
    expect(screen.getByText("Pavel", { selector: "p" })).toBeTruthy()
  })
})

test.each(ZOOMS)(
  "at zoom %d Open in Telegram sits at the photo's bottom right",
  async (zoom) => {
    renderAt(zoom, noPhoto)
    const link = screen.getByRole("link", { name: "Open Pavel in Telegram" })
    expect(link.getAttribute("href")).toBe(telegramWebViewChannelUrl("durov"))
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.className).toContain("-right-1")
    // Raised above a compact card's or a tile's selection layer.
    expect(link.className).toContain("z-20")
    await act(() => Promise.resolve())
  },
)
