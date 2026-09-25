import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { toast } from "sonner"

import { copyTextToClipboard } from "./clipboard"

/**
 * Under automation (`navigator.webdriver`) the async Clipboard API needs a
 * permission nobody grants, so the copy goes through a hidden textarea and
 * `execCommand` first. Everywhere else it goes straight to the Clipboard API.
 *
 * happy-dom reports `webdriver` as true and has neither `execCommand` nor a
 * usable clipboard, so each test shadows all three and `afterEach` removes the
 * shadows.
 */
type Host = { webdriver?: boolean; clipboard?: unknown }
const nav = navigator as unknown as Host
const doc = document as unknown as { execCommand?: (cmd: string) => boolean }

const written: string[] = []
const spies: Array<{ mockRestore: () => void }> = []

function setup(opts: {
  webdriver: boolean
  execCommand?: boolean
  clipboard?: "ok" | "throws" | "absent"
}) {
  Object.defineProperty(navigator, "webdriver", {
    value: opts.webdriver,
    configurable: true,
  })
  const clipboard =
    opts.clipboard === "absent"
      ? undefined
      : {
          writeText: async (text: string) => {
            if (opts.clipboard === "throws") throw new Error("denied")
            written.push(`clipboard:${text}`)
          },
        }
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  })
  doc.execCommand = () => {
    written.push("execCommand")
    return opts.execCommand ?? false
  }
  const success = spyOn(toast, "success")
  const error = spyOn(toast, "error")
  spies.push(success, error)
  return { success, error }
}

afterEach(() => {
  written.length = 0
  delete nav.webdriver
  delete nav.clipboard
  delete doc.execCommand
  for (const s of spies.splice(0)) s.mockRestore()
})

describe("copyTextToClipboard", () => {
  test("a normal browser writes through the Clipboard API only", async () => {
    const { success } = setup({ webdriver: false, clipboard: "ok" })
    expect(await copyTextToClipboard("hi", "Copied!")).toBe(true)
    expect(written).toEqual(["clipboard:hi"])
    expect(success).toHaveBeenCalledWith("Copied!")
  })

  test("under automation the textarea copy wins when it works", async () => {
    setup({ webdriver: true, execCommand: true, clipboard: "ok" })
    expect(await copyTextToClipboard("hi")).toBe(true)
    expect(written).toEqual(["execCommand"])
    // The textarea is taken back out of the page.
    expect(document.querySelector("textarea")).toBeNull()
  })

  test("under automation a failed textarea copy falls back to the API", async () => {
    setup({ webdriver: true, execCommand: false, clipboard: "ok" })
    expect(await copyTextToClipboard("hi")).toBe(true)
    expect(written).toEqual(["execCommand", "clipboard:hi"])
  })

  test("says the browser cannot copy when there is no Clipboard API", async () => {
    const { error, success } = setup({ webdriver: false, clipboard: "absent" })
    expect(await copyTextToClipboard("hi")).toBe(false)
    expect(error).toHaveBeenCalledWith(
      "Clipboard not supported in this browser",
    )
    expect(success).not.toHaveBeenCalled()
  })

  test("reports a rejected write instead of throwing", async () => {
    const { error } = setup({ webdriver: false, clipboard: "throws" })
    expect(await copyTextToClipboard("hi")).toBe(false)
    expect(error).toHaveBeenCalledWith("Failed to copy to clipboard")
  })
})
