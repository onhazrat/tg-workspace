import { describe, expect, test } from "bun:test"
import { Inbox } from "lucide-react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  TgHeroEmptyState,
  TgSegmentedControl,
  tgSegmentedTrackVariants,
} from "./tg-segmented"

describe("TgSegmentedControl", () => {
  test("renders options and marks selected", () => {
    const html = renderToStaticMarkup(
      <TgSegmentedControl
        aria-label="Mode"
        value="logs"
        onChange={() => {}}
        options={[
          { value: "logs", label: "Logs" },
          { value: "telemetry", label: "Telemetry" },
        ]}
      />,
    )
    expect(html).toContain("Logs")
    expect(html).toContain("Telemetry")
    expect(html).toContain('data-selected="true"')
    expect(html).toContain('aria-pressed="true"')
  })

  test("track class is centralized", () => {
    const track = tgSegmentedTrackVariants({ size: "md" })
    expect(track).toContain("bg-app-ink/5")
    expect(track).toContain("p-1")
    expect(track).toContain("rounded-lg")
    expect(track).toContain("border-app-ink/10")
    expect(tgSegmentedTrackVariants()).toContain("bg-app-ink/5")
    expect(tgSegmentedTrackVariants()).toContain("border-app-ink/10")
    expect(tgSegmentedTrackVariants({ size: "md" })).toContain("rounded-lg")
  })

  test("dense size omits rounded-lg and uses opacity selection", () => {
    const track = tgSegmentedTrackVariants({ size: "dense" })
    expect(track).not.toContain("rounded-lg")
    expect(track).toContain("gap-2")

    const html = renderToStaticMarkup(
      <TgSegmentedControl
        size="dense"
        aria-label="Theme"
        value="light"
        onChange={() => {}}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark", "data-testid": "theme-dark" },
        ]}
      />,
    )
    expect(html).toContain('data-testid="theme-dark"')
    expect(html).toContain("opacity-40")
  })
})

describe("TgHeroEmptyState", () => {
  test("renders icon, title, description, children", () => {
    const html = renderToStaticMarkup(
      <TgHeroEmptyState
        icon={<Inbox size={20} />}
        title="No posts"
        description="Select channels to see posts."
      >
        <button type="button">Go to channels</button>
      </TgHeroEmptyState>,
    )
    expect(html).toContain("No posts")
    expect(html).toContain("Select channels to see posts.")
    expect(html).toContain("Go to channels")
  })
})
