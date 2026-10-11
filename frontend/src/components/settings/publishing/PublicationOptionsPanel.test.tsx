import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PublicationOptionsPanel } from "./PublicationOptionsPanel"

afterEach(cleanup)

const mount = () => {
  const onCitationStyle = mock(() => {})
  const onLinkPreviews = mock(() => {})
  const onTimeZone = mock(() => {})
  render(
    <PublicationOptionsPanel
      citationStyle="asWritten"
      linkPreviews={false}
      timeZone="Asia/Tehran"
      onCitationStyle={onCitationStyle}
      onLinkPreviews={onLinkPreviews}
      onTimeZone={onTimeZone}
    />,
  )
  return { onCitationStyle, onLinkPreviews, onTimeZone }
}

describe("PublicationOptionsPanel", () => {
  test("offers the three citation styles and saves the one picked", () => {
    const { onCitationStyle } = mount()
    const select = screen.getByLabelText("Citation style") as HTMLSelectElement

    expect([...select.options].map((o) => o.textContent)).toEqual([
      "As written",
      "By Channel name",
      "Numbered",
    ])
    fireEvent.change(select, { target: { value: "numbered" } })
    expect(onCitationStyle).toHaveBeenCalledWith("numbered")
  })

  test("turns link previews on from off", () => {
    const { onLinkPreviews } = mount()
    fireEvent.click(screen.getByLabelText("Link previews"))
    expect(onLinkPreviews).toHaveBeenCalledWith(true)
  })

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
