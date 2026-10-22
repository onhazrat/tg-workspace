/**
 * A `TgIconButton` with a tooltip as a Radix trigger (`asChild`). Its button
 * sits inside a Base UI tooltip trigger, and the menu must still open.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import { TgIconButton } from "./tg-icon-button"

afterEach(cleanup)

function mount(tooltip?: string) {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TgIconButton aria-label="More actions" tooltip={tooltip}>
          …
        </TgIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  )
  act(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), {
      key: "Enter",
    })
  })
}

describe("TgIconButton as a menu trigger", () => {
  test("opens the menu without a tooltip", () => {
    mount()
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy()
  })

  test("opens the menu with a tooltip", () => {
    mount("More actions")
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy()
  })
})
