import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import { __resetChannelPhotoCache } from "@/lib/channels/channel-photo-cache"
import { ChannelAvatar } from "./ChannelAvatar"
import { GALLERY_CAPTION_ATTR } from "./post-card/PhotoViewer"

afterEach(() => {
  cleanup()
  __resetChannelPhotoCache()
})

const channel = {
  id: "c1",
  name: "durov",
  displayName: "Pavel",
  photoUrl: "https://example.test/durov.jpg",
}

describe("ChannelAvatar", () => {
  test("a viewable avatar opens the viewer and joins its gallery", async () => {
    render(<ChannelAvatar channel={channel} viewable viewShortcut="p" />)
    const button = await screen.findByRole("button", {
      name: "View Pavel's photo",
    })
    expect(button.getAttribute("data-shortcut")).toBe("p")
    expect(
      screen.getByAltText("Pavel").getAttribute(GALLERY_CAPTION_ATTR),
    ).toBe("Pavel")
  })

  // A tile's photo sits under its selection overlay, so the viewer opens
  // from a corner button and the photo itself stays outside any button.
  test("a corner trigger leaves the photo unwrapped and still in the gallery", async () => {
    render(<ChannelAvatar channel={channel} viewable viewTrigger="corner" />)
    await screen.findByRole("button", { name: "View Pavel's photo" })
    const img = screen.getByAltText("Pavel")
    expect(img.closest("button")).toBeNull()
    expect(img.getAttribute(GALLERY_CAPTION_ATTR)).toBe("Pavel")
  })

  // The Posts feed's gallery reads every marked image on the page, so an
  // unmarked post-header avatar is what keeps avatars out of it.
  test("a plain avatar is neither a button nor in the gallery", async () => {
    render(<ChannelAvatar channel={channel} />)
    const img = await screen.findByAltText("Pavel")
    expect(img.hasAttribute(GALLERY_CAPTION_ATTR)).toBe(false)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
