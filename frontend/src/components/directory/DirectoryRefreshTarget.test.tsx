/**
 * The Refresh target control (DRP-02), props-only: a whole number from 1 to
 * 1000, Set or Clear, and in the panel what is set now.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  DirectoryRefreshTarget,
  MAX_REFRESH_TARGET,
  refreshTargetValue,
} from "./DirectoryRefreshTarget"

afterEach(cleanup)

describe("the target value", () => {
  test.each([
    ["1", 1],
    [" 40 ", 40],
    [String(MAX_REFRESH_TARGET), MAX_REFRESH_TARGET],
  ])("%s reads as %d", (text, value) => {
    expect(refreshTargetValue(text)).toBe(value)
  })

  test.each(["", "0", "-3", "1.5", "abc", String(MAX_REFRESH_TARGET + 1)])(
    "%s is refused",
    (text) => {
      expect(refreshTargetValue(text)).toBeNull()
    },
  )
})

describe("the control", () => {
  test("Set sends the number and is off without one; Clear sends none", () => {
    const sent: (number | null)[] = []
    render(<DirectoryRefreshTarget onSet={(value) => sent.push(value)} />)
    const set = screen.getByRole("button", { name: "Set target" })
    expect(set).toHaveProperty("disabled", true)
    fireEvent.change(screen.getByLabelText("Refresh target"), {
      target: { value: "40" },
    })
    fireEvent.click(set)
    fireEvent.click(screen.getByRole("button", { name: "Clear target" }))
    expect(sent).toEqual([40, null])
  })

  test("the panel shows an entry's own target", () => {
    render(
      <DirectoryRefreshTarget onSet={() => {}} current={40} deployment={20} />,
    )
    expect(
      screen.getByTestId("directory-refresh-target").textContent,
    ).toContain("Target40")
    expect(screen.getByRole("button", { name: "Clear target" })).toHaveProperty(
      "disabled",
      false,
    )
  })

  test("an entry with none shows the deployment's, and has nothing to clear", () => {
    render(
      <DirectoryRefreshTarget
        onSet={() => {}}
        current={null}
        deployment={20}
      />,
    )
    expect(
      screen.getByTestId("directory-refresh-target").textContent,
    ).toContain("Target20 (deployment's)")
    expect(screen.getByRole("button", { name: "Clear target" })).toHaveProperty(
      "disabled",
      true,
    )
  })
})
