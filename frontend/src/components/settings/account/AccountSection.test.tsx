/**
 * Who is signed in and the way out, which lived in the template sidebar until
 * SET-01 deleted it.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { accountPanels, SignedInAs } from "./AccountSection"

afterEach(cleanup)

describe("SignedInAs", () => {
  test("names the account and signs it out", () => {
    const onSignOut = mock()
    render(<SignedInAs email="me@x.test" onSignOut={onSignOut} />)
    expect(screen.getByText("me@x.test")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})

describe("accountPanels", () => {
  // A superuser cannot delete its own account, so it gets no Danger zone —
  // the rule the template's /settings page stated.
  test("a superuser gets no Danger zone", () => {
    expect(accountPanels(false).map((p) => p.id)).toEqual([
      "profile",
      "password",
      "usage",
      "danger-zone",
    ])
    expect(accountPanels(true).map((p) => p.id)).toEqual([
      "profile",
      "password",
      "usage",
    ])
  })
})
