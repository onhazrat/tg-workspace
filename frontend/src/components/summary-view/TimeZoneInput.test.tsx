/** The publish panel's time zone box: saved once left, and only a known zone. */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TimeZoneInput } from "./TimeZoneInput"

afterEach(cleanup)

const mount = () => {
  const onTimeZone = mock((_zone: string) => {})
  render(
    <>
      <label htmlFor="tz">Time zone</label>
      <TimeZoneInput id="tz" timeZone="Asia/Tehran" onTimeZone={onTimeZone} />
    </>,
  )
  return { onTimeZone }
}

describe("TimeZoneInput", () => {
  test("shows the saved time zone and saves an edit once it is left", () => {
    const { onTimeZone } = mount()
    const input = screen.getByLabelText("Time zone") as HTMLInputElement

    expect(input.value).toBe("Asia/Tehran")
    fireEvent.change(input, { target: { value: "Europe/Ber" } })
    fireEvent.change(input, { target: { value: "Europe/Berlin" } })
    expect(onTimeZone).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(onTimeZone).toHaveBeenCalledWith("Europe/Berlin")
  })

  test("a zone nobody knows is not saved, and the saved one comes back", () => {
    const { onTimeZone } = mount()
    const input = screen.getByLabelText("Time zone") as HTMLInputElement

    fireEvent.change(input, { target: { value: "Asia/Teh" } })
    fireEvent.blur(input)

    expect(onTimeZone).not.toHaveBeenCalled()
    expect(input.value).toBe("Asia/Tehran")
  })

  test("an emptied zone is saved as UTC", () => {
    const { onTimeZone } = mount()
    const input = screen.getByLabelText("Time zone") as HTMLInputElement

    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)

    expect(onTimeZone).toHaveBeenCalledWith("")
  })
})
