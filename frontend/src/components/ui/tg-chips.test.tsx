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

  test("selection chips preserve author casing, filter chips stay uppercase", () => {
    // Selection chips label user-authored tag and setting-group names, so
    // uppercasing them would misreport the operator's own data ("iOS" → "IOS").
    // Filter chips label fixed UI vocabulary, where the caps are just style.
    for (const state of ["selected", "partial", "idle"] as const) {
      expect(tgSelectionChipVariants({ state })).not.toContain("uppercase")
    }
    expect(tgFilterChipVariants({ selected: false })).toContain("uppercase")

    const html = renderToStaticMarkup(
      <TgSelectionChip state="idle">iOS</TgSelectionChip>,
    )
    expect(html).toContain("iOS")
    expect(html).not.toContain("uppercase")
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
