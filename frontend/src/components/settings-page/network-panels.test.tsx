/**
 * The Network topic's proxy pool and Tor actions (SET-03), props only. The
 * pool keeps what the old panel had: credentials masked until revealed,
 * per-proxy slots, test results, live health; Tor keeps Test and Rotate.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ProxiesView, TorActionsView } from "./network-panels"

afterEach(cleanup)

const URL_A = "socks5h://user:secret@a.example:1080"
const URL_B = "http://b.example:8080"

const props = {
  proxies: [URL_A, URL_B],
  defaultSlots: 2,
  overrides: { [URL_B]: 5 },
  results: {},
  testing: false,
  cooling: [],
  envFallback: false,
  onAdd: () => {},
  onRemove: async () => {},
  onSlots: () => {},
  onTestAll: () => {},
}

describe("ProxiesView", () => {
  test("credentials stay masked until revealed", () => {
    render(<ProxiesView {...props} />)
    expect(screen.queryByText(URL_A)).toBeNull()
    expect(document.body.textContent).not.toContain("secret")
    fireEvent.click(screen.getByRole("button", { name: "Show credentials" }))
    expect(screen.getByText(URL_A)).toBeTruthy()
  })

  test("each proxy shows its slots, its own or the default", () => {
    render(<ProxiesView {...props} />)
    const slots = screen.getAllByRole("textbox", {
      name: /^Slots for/,
    }) as HTMLInputElement[]
    expect(slots.map((s) => s.value)).toEqual(["", "5"])
    expect(slots[0].placeholder).toBe("2")
  })

  test("a slot count saves on Enter; blank goes back to the default", () => {
    const onSlots = mock((_url: string, _n: number | null) => {})
    render(<ProxiesView {...props} onSlots={onSlots} />)
    const [a, b] = screen.getAllByRole("textbox", { name: /^Slots for/ })
    fireEvent.change(a, { target: { value: "3" } })
    fireEvent.keyDown(a, { key: "Enter" })
    fireEvent.change(b, { target: { value: "" } })
    fireEvent.keyDown(b, { key: "Enter" })
    expect(onSlots.mock.calls).toEqual([
      [URL_A, 3],
      [URL_B, null],
    ])
  })

  test("a slot count out of 1 to 20 is refused", () => {
    const onSlots = mock(() => {})
    render(<ProxiesView {...props} onSlots={onSlots} />)
    const [a] = screen.getAllByRole("textbox", { name: /^Slots for/ })
    fireEvent.change(a, { target: { value: "21" } })
    fireEvent.keyDown(a, { key: "Enter" })
    expect(onSlots).not.toHaveBeenCalled()
  })

  test("test results and cooling proxies read on their row", () => {
    render(
      <ProxiesView
        {...props}
        results={{
          [URL_A]: { success: true, latency: 120, ip: "1.2.3.4" },
          [URL_B]: { success: false, error: "timed out" },
        }}
        cooling={[{ url: URL_B, cooldownRemaining: 90 }]}
      />,
    )
    const rows = screen.getAllByRole("row").slice(1)
    expect(rows[0].textContent).toContain("120 ms · 1.2.3.4")
    expect(rows[0].textContent).toContain("Healthy")
    expect(rows[1].textContent).toContain("Failed")
    expect(rows[1].textContent).toContain("Cooling down 1:30")
  })

  test("pasted URLs are added, and Test all tests the pool", () => {
    const onAdd = mock((_urls: string[]) => {})
    const onTestAll = mock(() => {})
    render(<ProxiesView {...props} onAdd={onAdd} onTestAll={onTestAll} />)
    fireEvent.click(screen.getByRole("button", { name: "Test all" }))
    expect(onTestAll).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Add proxies" }))
    fireEvent.change(screen.getByLabelText("Proxy URLs"), {
      target: { value: "http://c.example:1\nhttp://d.example:2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add 2" }))
    expect(onAdd).toHaveBeenCalledWith([
      "http://c.example:1",
      "http://d.example:2",
    ])
  })
})

const tor = {
  running: true,
  controlConnected: true,
  ip: null,
  testing: false,
  rotating: false,
  onTest: () => {},
  onRotate: () => {},
  onRestart: () => {},
}

describe("TorActionsView", () => {
  test("Test asks for the exit IP and shows it", () => {
    const onTest = mock(() => {})
    const { rerender } = render(<TorActionsView {...tor} onTest={onTest} />)
    fireEvent.click(screen.getByRole("button", { name: "Test" }))
    expect(onTest).toHaveBeenCalledTimes(1)
    rerender(<TorActionsView {...tor} ip="5.6.7.8" />)
    expect(screen.getByText(/5\.6\.7\.8/)).toBeTruthy()
  })

  test("Rotate needs the control port, Test needs Tor running", () => {
    render(<TorActionsView {...tor} running={false} controlConnected={false} />)
    const button = (name: string) =>
      screen.getByRole("button", { name }) as HTMLButtonElement
    expect(button("Test").disabled).toBe(true)
    expect(button("Rotate").disabled).toBe(true)
    expect(button("Restart").disabled).toBe(false)
    expect(screen.getByText("Not running")).toBeTruthy()
  })
})
