import { describe, expect, it } from "bun:test"

import { ApiError } from "./api/base"
import { handleError } from "./utils"

/** What `handleError` hands the toast it is bound to, for one error. */
function shown(err: unknown): string {
  let message = ""
  handleError.call((msg: string) => {
    message = msg
  }, err)
  return message
}

describe("handleError", () => {
  it("shows the first field error of a 422 body", () => {
    const err = new ApiError(422, "Unprocessable", {
      detail: [{ msg: "password too short" }, { msg: "email invalid" }],
    })
    expect(shown(err)).toBe("password too short")
  })

  it("falls back to the flattened message for a string or empty detail", () => {
    expect(shown(new ApiError(400, "Bad token", { detail: "Bad token" }))).toBe(
      "Bad token",
    )
    expect(shown(new ApiError(422, "Unprocessable", { detail: [] }))).toBe(
      "Unprocessable",
    )
    expect(shown(new ApiError(502, "Bad gateway"))).toBe("Bad gateway")
  })

  it("shows a plain Error's message and a fixed line for anything else", () => {
    expect(shown(new Error("offline"))).toBe("offline")
    expect(shown("boom")).toBe("Something went wrong.")
  })
})
