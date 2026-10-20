/** The pieces the Settings panels are drawn with (SET-03), props only. */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { ConfirmButton, ListTable, PanelField, Status } from "./kit"

afterEach(cleanup)

describe("ListTable", () => {
  test("an empty list says why instead of drawing no rows", () => {
    render(
      <ListTable columns={[{ label: "Key" }]} isEmpty empty="No keys yet.">
        <tr>
          <td>never</td>
        </tr>
      </ListTable>,
    )
    expect(screen.getByText("No keys yet.")).toBeTruthy()
    expect(screen.queryByText("never")).toBeNull()
  })
})

describe("Status", () => {
  test("reads its words beside a dot", () => {
    render(<Status tone="bad">Failed</Status>)
    expect(screen.getByText("Failed")).toBeTruthy()
  })
})

describe("ConfirmButton", () => {
  test("asks first and acts only on the confirmation", async () => {
    const onConfirm = mock(async () => {})
    render(
      <ConfirmButton
        label="Delete Work key"
        title="Delete Work key?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Delete Work key" }))
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  test("a refusal keeps the question open and says why", async () => {
    render(
      <ConfirmButton
        label="Delete Work key"
        title="Delete Work key?"
        confirmLabel="Delete"
        onConfirm={async () => {
          throw new Error("Still in use")
        }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Delete Work key" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(screen.getByText("Still in use")).toBeTruthy())
    expect(screen.getByRole("dialog")).toBeTruthy()
  })
})

describe("PanelField", () => {
  test("commits on Enter, not while typing, and Escape undoes", () => {
    const onCommit = mock((_: string) => {})
    render(<PanelField label="Full name" value="Ann" onCommit={onCommit} />)
    const input = screen.getByLabelText("Full name") as HTMLInputElement
    fireEvent.change(input, { target: { value: "Bea" } })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onCommit).toHaveBeenCalledWith("Bea")
    fireEvent.change(input, { target: { value: "Cy" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(input.value).toBe("Ann")
  })

  test("an invalid draft is refused before it is sent", () => {
    const onCommit = mock((_: string) => {})
    render(
      <PanelField
        label="Email"
        value="a@b.test"
        invalid={(v) => (v.includes("@") ? null : "Invalid email address")}
        onCommit={onCommit}
      />,
    )
    const input = screen.getByLabelText("Email")
    fireEvent.change(input, { target: { value: "nope" } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByText("Invalid email address")).toBeTruthy()
  })
})
