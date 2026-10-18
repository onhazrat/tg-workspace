/**
 * The Directory's Add box (DADD), props-only: every pasted handle is either
 * added or not a handle, one click sends the new ones, and the server's three
 * counts are what the box reports.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DirectoryAddResponse } from "@/client"
import { DirectoryAddBox } from "./DirectoryAddBox"

afterEach(cleanup)

function mount(answer: DirectoryAddResponse | null) {
  const calls: string[][] = []
  render(
    <DirectoryAddBox
      onAdd={async (handles) => {
        calls.push(handles)
        return answer
      }}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Add to Directory" }))
  const box = () =>
    screen.getByLabelText(
      "Handles to add to the Directory",
    ) as HTMLTextAreaElement
  const paste = (text: string) =>
    fireEvent.change(box(), { target: { value: text } })
  const submit = () => screen.getByTestId("directory-add-submit")
  return { calls, box, paste, submit }
}

describe("DirectoryAddBox", () => {
  test("sends the handles and reports the server's counts", async () => {
    const { calls, box, paste, submit } = mount({
      added: 1,
      alreadyInDirectory: 1,
      invalid: 1,
    })
    paste("@durov t.me/s/telegram 1digit joinchat")
    expect(
      screen.getAllByTestId("directory-add-row").map((r) => r.textContent),
    ).toEqual([
      "@durov · will add",
      "@telegram · will add",
      "@1digit · not a handle",
      "@joinchat · will add",
    ])
    expect(submit().textContent).toBe("Add 3")
    await act(async () => fireEvent.click(submit()))
    expect(calls).toEqual([["durov", "telegram", "joinchat"]])
    expect(screen.getByTestId("directory-add-result").textContent).toBe(
      "Added 1 · 1 already in the Directory · 1 not a handle",
    )
    expect(box().value).toBe("")
  })

  test("is disabled with nothing new to send", () => {
    const { paste, submit } = mount(null)
    expect(submit().hasAttribute("disabled")).toBe(true)
    paste("1digit abc")
    expect(submit().hasAttribute("disabled")).toBe(true)
  })

  test("keeps the paste when the add failed", async () => {
    const { box, paste, submit } = mount(null)
    paste("durov")
    await act(async () => fireEvent.click(submit()))
    expect(box().value).toBe("durov")
    expect(screen.queryByTestId("directory-add-result")).toBeNull()
  })
})
