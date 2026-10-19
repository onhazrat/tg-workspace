import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  TgInlineChoice,
  TgInlineSegment,
  TgInlineSegments,
} from "./tg-inline-segments"

describe("TgInlineSegments", () => {
  test("a pressed segment is raised, an unpressed one is quiet", () => {
    const html = renderToStaticMarkup(
      <TgInlineSegments aria-label="Search in" className="inline-flex">
        <TgInlineSegment pressed>Name</TgInlineSegment>
        <TgInlineSegment pressed={false}>Bio</TgInlineSegment>
      </TgInlineSegments>,
    )
    const [name, bio] = html.split("<button").slice(1)
    expect(name).toContain('aria-pressed="true"')
    expect(name).toContain("bg-app-card")
    expect(bio).toContain('aria-pressed="false"')
    expect(bio).toContain("text-app-ink/50")
    // A caller's layout class replaces the track's own, not appends to it.
    expect(html).toContain("inline-flex")
    expect(html).not.toMatch(/class="flex /)
  })

  test("a choice presses only its value and can disable an option", () => {
    const html = renderToStaticMarkup(
      <TgInlineChoice
        aria-label="Chat mode"
        value="semantic"
        onChange={() => {}}
        options={[
          { value: "full_scope", label: "Selected posts" },
          { value: "semantic", label: "Semantic", disabled: true },
        ]}
      />,
    )
    const [posts, semantic] = html.split("<button").slice(1)
    expect(posts).toContain('aria-pressed="false"')
    expect(semantic).toContain('aria-pressed="true"')
    expect(semantic).toContain("disabled")
    expect(posts).not.toContain("disabled=")
  })
})
