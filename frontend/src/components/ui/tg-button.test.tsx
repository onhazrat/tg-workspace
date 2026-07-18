import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TgButton, tgButtonVariants } from "./tg-button"

describe("TgButton", () => {
  test("renders each variant class recipe", () => {
    for (const variant of [
      "primary",
      "secondary",
      "ghost",
      "danger",
      "dangerSoft",
      "successSoft",
      "infoSoft",
      "link",
    ] as const) {
      const html = renderToStaticMarkup(
        <TgButton variant={variant}>Action</TgButton>,
      )
      expect(html).toContain('data-variant="' + variant + '"')
      expect(html).toContain("Action")
      expect(tgButtonVariants({ variant })).toBeTruthy()
    }
  })

  test("loading sets aria-busy, disables, and shows spinner", () => {
    const html = renderToStaticMarkup(<TgButton loading>Save</TgButton>)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain("disabled")
    expect(html).toContain("animate-spin")
    expect(html).toContain("Save")
  })

  test("loadingLabel replaces children while busy", () => {
    const html = renderToStaticMarkup(
      <TgButton loading loadingLabel="Saving…">
        Save
      </TgButton>,
    )
    expect(html).toContain("Saving…")
    expect(html).not.toContain(">Save<")
  })

  test("disabled prop disables the button", () => {
    const html = renderToStaticMarkup(<TgButton disabled>Go</TgButton>)
    expect(html).toContain("disabled")
  })

  test("primary includes fill tokens used by theme asserts", () => {
    const classes = tgButtonVariants({ variant: "primary" })
    expect(classes).toContain("bg-app-ink")
    expect(classes).toContain("text-app-bg")
    expect(classes).toContain("hover:opacity-90")
    expect(classes).toContain("focus-visible:ring-2")
  })

  test("ghost includes hover background for light/dark visibility", () => {
    const classes = tgButtonVariants({ variant: "ghost" })
    expect(classes).toContain("hover:bg-app-ink/5")
  })

  test("successSoft and infoSoft mirror soft-fill recipes", () => {
    expect(tgButtonVariants({ variant: "successSoft" })).toContain(
      "bg-green-500/10",
    )
    expect(tgButtonVariants({ variant: "infoSoft" })).toContain(
      "bg-blue-500/10",
    )
  })

  test("link variant collapses padding for compact header actions", () => {
    const classes = tgButtonVariants({ variant: "link", size: "sm" })
    expect(classes).toContain("hover:underline")
    expect(classes).toContain("h-auto")
    expect(classes).toContain("px-0")
  })
})
