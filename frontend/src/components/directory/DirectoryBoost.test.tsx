/**
 * The Priority boost control (DPF), props-only: a whole number within the
 * server's range, Set or Add, and the entry's boost now in the panel.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { boostValue, DirectoryBoost, MAX_BOOST } from "./DirectoryBoost"

afterEach(cleanup)

describe("the boost value", () => {
  test.each([
    ["5", 5],
    ["-3", -3],
    ["+1", 1],
    [String(MAX_BOOST), MAX_BOOST],
  ])("%s reads as %d", (text, value) => {
    expect(boostValue(text)).toBe(value)
  })

  test.each(["", "1.5", "abc", String(MAX_BOOST + 1)])("%s is refused", (t) => {
    expect(boostValue(t)).toBeNull()
  })
})

describe("the control", () => {
  test("Set and Add send the number and are off without one", () => {
    const sent: [string, number][] = []
    render(
      <DirectoryBoost onBoost={(mode, value) => sent.push([mode, value])} />,
    )
    const set = screen.getByRole("button", { name: "Set" })
    expect(set).toHaveProperty("disabled", true)
    fireEvent.change(screen.getByLabelText("Priority boost"), {
      target: { value: "-2" },
    })
    fireEvent.click(set)
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    expect(sent).toEqual([
      ["set", -2],
      ["add", -2],
    ])
  })

  test("the panel shows the boost and the effective priority now", () => {
    render(
      <DirectoryBoost onBoost={() => {}} current={3} effective={1999997} />,
    )
    expect(screen.getByTestId("directory-boost").textContent).toContain(
      "Boost3(effective 1999997)",
    )
  })
})
