import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  TgFieldLabel,
  TgHelpText,
  TgInput,
  TgTextarea,
  tgFieldClassName,
  tgInputVariants,
} from "./tg-input"

describe("TgInput", () => {
  test("settings variant uses the mono field recipe, and never shouts", () => {
    const html = renderToStaticMarkup(
      <TgInput variant="settings" defaultValue="x" />,
    )
    expect(html).toContain('data-variant="settings"')
    expect(tgInputVariants({ variant: "settings" })).toContain(
      "font-mono tracking-wide",
    )
    expect(tgFieldClassName).toContain("p-3 text-[11px]")
    // The `uppercase` this variant used to carry is gone, and the assertion is
    // here rather than in a comment because the placeholders it shouted are now
    // written in sentence case: putting the class back would not restore the
    // old look, it would double-capitalise "Provider API key" into something
    // nobody wrote. Both halves have to stay removed together.
    expect(tgInputVariants({ variant: "settings" })).not.toContain("uppercase")
  })

  test("muted variant uses toolbar recipe", () => {
    const html = renderToStaticMarkup(
      <TgInput variant="muted" placeholder="Search" />,
    )
    expect(html).toContain('data-variant="muted"')
    expect(html).toContain("Search")
    expect(tgInputVariants({ variant: "muted" })).toContain("bg-app-muted/50")
  })

  test("disabled opacity class present", () => {
    const html = renderToStaticMarkup(<TgInput disabled />)
    expect(html).toContain("disabled")
    expect(tgInputVariants({ variant: "settings" })).toContain(
      "disabled:opacity-40",
    )
  })

  test("focus-visible ring class present on variants", () => {
    expect(tgInputVariants({ variant: "settings" })).toContain(
      "focus-visible:ring-2",
    )
    expect(tgInputVariants({ variant: "muted" })).toContain(
      "focus-visible:ring-2",
    )
  })

  test("TgTextarea and TgFieldLabel render", () => {
    const html = renderToStaticMarkup(
      <>
        <TgFieldLabel htmlFor="notes">Notes</TgFieldLabel>
        <TgTextarea id="notes" defaultValue="hello" />
      </>,
    )
    expect(html).toContain("Notes")
    expect(html).toContain("hello")
    expect(html).toContain('data-slot="tg-textarea"')
  })

  test("TgHelpText uses shared italic helper recipe", () => {
    const html = renderToStaticMarkup(
      <TgHelpText>Helper copy for settings fields.</TgHelpText>,
    )
    expect(html).toContain('data-slot="tg-help-text"')
    expect(html).toContain("Helper copy for settings fields.")
    expect(html).toContain("opacity-40")
    expect(html).toContain("italic")
  })
})
