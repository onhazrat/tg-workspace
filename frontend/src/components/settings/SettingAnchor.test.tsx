import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SETTING_HIGHLIGHT_CLASS, SettingAnchor } from "./SettingAnchor"

describe("SettingAnchor", () => {
  test("exposes stable deep-link id and data-setting-id", () => {
    const html = renderToStaticMarkup(
      <SettingAnchor settingId="postRetentionDays">
        <span>Retention</span>
      </SettingAnchor>,
    )
    expect(html).toContain('id="setting-postRetentionDays"')
    expect(html).toContain('data-setting-id="postRetentionDays"')
    expect(html).toContain("scroll-mt-24")
    expect(html).toContain("Retention")
  })

  test("applies highlight class when highlighted", () => {
    const html = renderToStaticMarkup(
      <SettingAnchor settingId="theme" highlighted>
        Theme
      </SettingAnchor>,
    )
    expect(html).toContain(SETTING_HIGHLIGHT_CLASS.split(" ")[0])
  })
})
