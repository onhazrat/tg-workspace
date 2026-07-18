import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TgButton } from "./tg-button"
import { confirmVariantMap } from "./tg-confirm-dialog"

describe("TgConfirmDialog", () => {
  test("maps confirm variants onto TgButton variants", () => {
    expect(confirmVariantMap.default).toBe("primary")
    expect(confirmVariantMap.destructive).toBe("danger")
    expect(confirmVariantMap.dangerSoft).toBe("dangerSoft")
  })

  test("destructive confirm footer buttons use danger + secondary", () => {
    const html = renderToStaticMarkup(
      <>
        <TgButton variant="secondary">Keep</TgButton>
        <TgButton variant={confirmVariantMap.destructive}>Delete</TgButton>
      </>,
    )
    expect(html).toContain("Keep")
    expect(html).toContain("Delete")
    expect(html).toContain('data-variant="danger"')
    expect(html).toContain('data-variant="secondary"')
  })

  test("dangerSoft confirm uses soft-red button variant", () => {
    const html = renderToStaticMarkup(
      <TgButton variant={confirmVariantMap.dangerSoft}>Confirm</TgButton>,
    )
    expect(html).toContain('data-variant="dangerSoft"')
  })

  test("loading shows loadingLabel on confirm button", () => {
    const html = renderToStaticMarkup(
      <TgButton
        variant={confirmVariantMap.destructive}
        loading
        loadingLabel="Deleting…"
      >
        Delete
      </TgButton>,
    )
    expect(html).toContain("Deleting…")
    expect(html).toContain('aria-busy="true"')
  })
})
