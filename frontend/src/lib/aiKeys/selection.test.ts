/**
 * Which Key the client names, now that it names one at all.
 *
 * Writing the selection through closed a real gap — the chip showed one Key
 * while `withAiKey` sent nothing and let the server pick another — but it also
 * moved a decision from the server to the browser. `resolve_ai_key` takes
 * `(validated or rows)[0]`, and the list arrives sorted newest write first, so
 * a client that picked `[0]` would override the server on exactly the case its
 * rule exists for: a Key saved today whose provider check failed sorts ahead of
 * a working Key saved last week.
 */
import { afterEach, describe, expect, it } from "bun:test"

import {
  reconcileAiKeySelection,
  rememberAiKeyId,
  selectedAiKeyId,
} from "@/lib/aiKeys/selection"
import type { AiKey } from "@/lib/aiKeys/store"

function key(id: string, lastValidated: string | null): AiKey {
  return {
    id,
    label: id,
    provider: "gemini",
    baseUrl: null,
    hasKey: true,
    lastValidated,
  } as unknown as AiKey
}

afterEach(() => rememberAiKeyId(null))

describe("reconcileAiKeySelection", () => {
  it("selects nothing when the account has no keys", () => {
    reconcileAiKeySelection([])
    expect(selectedAiKeyId()).toBeNull()
  })

  it("prefers a verified key over a newer unverified one", () => {
    // The list is newest first, so `[0]` is the key whose provider check
    // failed. Naming it would send every run to a Key the server would have
    // skipped.
    reconcileAiKeySelection([
      key("broken-but-newest", null),
      key("older-and-working", "2026-09-01T00:00:00Z"),
    ])
    expect(selectedAiKeyId()).toBe("older-and-working")
  })

  it("takes the newest when none is verified", () => {
    reconcileAiKeySelection([key("newest", null), key("older", null)])
    expect(selectedAiKeyId()).toBe("newest")
  })

  it("leaves a deliberate choice alone", () => {
    rememberAiKeyId("older")
    reconcileAiKeySelection([
      key("newest", "2026-09-02T00:00:00Z"),
      key("older", null),
    ])
    expect(selectedAiKeyId()).toBe("older")
  })

  it("moves to another key when the selected one is deleted", () => {
    // Not merely forgotten: an account still holding a Key must not be left
    // with no selection, or every run button gates on a Key it has.
    rememberAiKeyId("gone")
    reconcileAiKeySelection([key("survivor", null)])
    expect(selectedAiKeyId()).toBe("survivor")
  })

  it("forgets the selection when the last key is deleted", () => {
    rememberAiKeyId("gone")
    reconcileAiKeySelection([])
    expect(selectedAiKeyId()).toBeNull()
  })
})
