import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  TgFilterChip,
  TgMetaChip,
  TgSelectionChip,
  tgFilterChipVariants,
  tgMetaChipVariants,
  tgSelectionChipVariants,
} from "./tg-chips"

describe("TG chips", () => {
  test("selection chip states", () => {
    for (const state of ["selected", "partial", "idle"] as const) {
      const html = renderToStaticMarkup(
        <TgSelectionChip state={state}>{state}</TgSelectionChip>,
      )
      expect(html).toContain(`data-state="${state}"`)
      expect(tgSelectionChipVariants({ state })).toBeTruthy()
    }
  })

  test("meta chip sizes", () => {
    expect(tgMetaChipVariants({ size: "card" })).toContain("text-[10px]")
    expect(tgMetaChipVariants({ size: "history" })).toContain("font-mono")
    const html = renderToStaticMarkup(
      <TgMetaChip size="history">3 posts</TgMetaChip>,
    )
    expect(html).toContain("3 posts")
    expect(html).toContain('data-size="history"')
  })

  test("filter chip selected/idle", () => {
    const selected = renderToStaticMarkup(
      <TgFilterChip selected>Lang</TgFilterChip>,
    )
    expect(selected).toContain('data-selected="true"')
    expect(selected).toContain('aria-pressed="true"')
    expect(tgFilterChipVariants({ selected: true })).toContain("bg-app-ink")
    expect(tgFilterChipVariants({ selected: false })).toContain(
      "hover:bg-app-ink/5",
    )
  })
})
