import { describe, expect, test } from "bun:test"
import { Settings } from "lucide-react"
import { renderToStaticMarkup } from "react-dom/server"
import { TgSettingsSection } from "./tg-settings-section"

describe("TgSettingsSection", () => {
  test("renders icon, title, and children", () => {
    const html = renderToStaticMarkup(
      <TgSettingsSection icon={Settings} title="Appearance">
        <p>Body content</p>
      </TgSettingsSection>,
    )
    expect(html).toContain("Appearance")
    expect(html).toContain("Body content")
    expect(html).toContain("bg-app-card")
    expect(html).toContain("border-app-ink/10")
    expect(html).toContain("p-6")
    expect(html).toContain("shadow-sm")
  })

  test("renders subtitle and actions in the header", () => {
    const html = renderToStaticMarkup(
      <TgSettingsSection
        icon={Settings}
        title="Table Sizes"
        subtitle="Last calculated: just now"
        actions={<button type="button">Export</button>}
      >
        <p>Tables</p>
      </TgSettingsSection>,
    )
    expect(html).toContain("Table Sizes")
    expect(html).toContain("Last calculated: just now")
    expect(html).toContain("Export")
    expect(html).toContain("justify-between")
  })
})
