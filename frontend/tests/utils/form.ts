import type { Locator } from "@playwright/test"

export async function replaceFieldValue(field: Locator, value: string) {
  await field.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set
    nativeInputValueSetter?.call(input, nextValue)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    input.dispatchEvent(new Event("blur", { bubbles: true }))
  }, value)
}
