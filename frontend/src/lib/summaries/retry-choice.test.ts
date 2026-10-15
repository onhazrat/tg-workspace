import { describe, expect, test } from "bun:test"

import { modelOnKey, promptFit, retryStart } from "./retry-choice"

const prompt = (tokens: number) => "x".repeat(tokens * 4)

describe("promptFit", () => {
  test("past the window it won't fit", () => {
    expect(promptFit(prompt(1001), 1000)).toBe("wont-fit")
  })

  test("past 80% of the window it is tight, up to the window itself", () => {
    expect(promptFit(prompt(1000), 1000)).toBe("tight")
    expect(promptFit(prompt(801), 1000)).toBe("tight")
  })

  test("at or under 80% it says nothing", () => {
    expect(promptFit(prompt(800), 1000)).toBeNull()
    expect(promptFit("short", 1000)).toBeNull()
  })

  test("estimates four characters per token, rounding down like the server", () => {
    // 4003 characters are 1000 tokens, not 1001.
    expect(promptFit(`${prompt(1000)}xyz`, 1000)).toBe("tight")
  })

  test("an unknown window or a missing prompt says nothing", () => {
    expect(promptFit(prompt(5000), null)).toBeNull()
    expect(promptFit(prompt(5000), undefined)).toBeNull()
    expect(promptFit(undefined, 1000)).toBeNull()
    expect(promptFit("", 1000)).toBeNull()
  })
})

const run = (keyId: string | null, model: string) => ({ keyId, model })

describe("retryStart", () => {
  test("starts at the last Attempt's Key and model", () => {
    const attempts = [run("k1", "m-old"), run("k2", "m-last")]
    expect(
      retryStart(attempts, ["k1", "k2"], "k1", "summary-m", () => null),
    ).toEqual({ keyId: "k2", model: "m-last" })
  })

  test("falls back to the selected Key when the last one is gone", () => {
    const attempts = [run("k1", "m-on-k1"), run("gone", "m-gone")]
    expect(retryStart(attempts, ["k1"], "k1", "summary-m", () => null)).toEqual(
      {
        keyId: "k1",
        model: "m-on-k1",
      },
    )
  })

  test("with no Attempt it is the selected Key and the Summary's model", () => {
    expect(retryStart([], ["k1"], "k1", "summary-m", () => null)).toEqual({
      keyId: "k1",
      model: "summary-m",
    })
  })
})

describe("modelOnKey", () => {
  const attempts = [run("k1", "first"), run("k2", "other"), run("k1", "latest")]

  test("is the model last run on that Key", () => {
    expect(modelOnKey(attempts, "k1", "remembered")).toBe("latest")
  })

  test("is the Key's remembered model when no Attempt ran on it", () => {
    expect(modelOnKey(attempts, "k3", "remembered")).toBe("remembered")
  })

  test("is nothing when neither knows", () => {
    expect(modelOnKey(attempts, "k3", null)).toBeNull()
  })
})
