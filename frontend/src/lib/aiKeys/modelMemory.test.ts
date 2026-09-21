/**
 * The model is remembered against the Key that pays for it.
 *
 * `selectedModel` is one setting, but a Key reaches one provider's catalogue —
 * so an account holding a Gemini Key and an OpenRouter Key had the previous
 * provider's model id left in the box every time it switched, pointing at an
 * endpoint that has never heard of it.
 */
import { afterEach, describe, expect, it } from "bun:test"

import {
  forgetModelsForMissingKeys,
  modelForKey,
  rememberModelForKey,
} from "@/lib/aiKeys/modelMemory"
import { scopedStorage } from "@/lib/storage/scoped"

afterEach(() => scopedStorage.removeItem("ai_key_models"))

describe("model memory", () => {
  it("keeps a model per key rather than one for all of them", () => {
    rememberModelForKey("gemini-key", "gemini-3-flash")
    rememberModelForKey("router-key", "anthropic/claude-sonnet-5")
    expect(modelForKey("gemini-key")).toBe("gemini-3-flash")
    expect(modelForKey("router-key")).toBe("anthropic/claude-sonnet-5")
  })

  it("answers null for a key nobody has chosen a model for", () => {
    // The caller leaves the current model alone on a null, which is what lets
    // this ship to an account that has never used it.
    rememberModelForKey("one", "m")
    expect(modelForKey("untouched")).toBeNull()
    expect(modelForKey(null)).toBeNull()
  })

  it("ignores an empty model and a missing key", () => {
    rememberModelForKey("k", "   ")
    rememberModelForKey(null, "m")
    expect(modelForKey("k")).toBeNull()
  })

  it("drops entries for keys the account no longer holds", () => {
    rememberModelForKey("kept", "a")
    rememberModelForKey("deleted", "b")
    forgetModelsForMissingKeys(["kept"])
    expect(modelForKey("kept")).toBe("a")
    expect(modelForKey("deleted")).toBeNull()
  })

  it("survives a corrupt stored value", () => {
    // Read inside an effect and a commit handler; a throw here would take the
    // page rather than the convenience.
    scopedStorage.setItem("ai_key_models", "{not json")
    expect(modelForKey("k")).toBeNull()
    rememberModelForKey("k", "m")
    expect(modelForKey("k")).toBe("m")
  })
})
