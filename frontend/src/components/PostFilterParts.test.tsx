import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"

import { PostCapControl, SemanticSearchBanner } from "./PostFilterParts"

afterEach(cleanup)

describe("SemanticSearchBanner", () => {
  test("renders nothing without a query", () => {
    expect(
      renderToStaticMarkup(
        <SemanticSearchBanner query="" onClear={() => {}} />,
      ),
    ).toBe("")
  })

  test("quotes the active query and clears it on request", () => {
    let cleared = 0
    render(<SemanticSearchBanner query="rockets" onClear={() => cleared++} />)
    expect(screen.getByText('"rockets"')).toBeTruthy()
    fireEvent.click(screen.getByText("Clear Search"))
    expect(cleared).toBe(1)
  })
})

describe("PostCapControl", () => {
  function mount(maxPostsPerChannel: number) {
    const set: number[] = []
    render(
      <PostCapControl
        maxPostsPerChannel={maxPostsPerChannel}
        setMaxPostsPerChannel={(value) => set.push(value)}
        maxPostsPerChannelMode="latest"
        setMaxPostsPerChannelMode={() => {}}
      />,
    )
    return { set, input: screen.getByPlaceholderText("Unlimited") }
  }

  test("shows no cap as a blank field, not 0", () => {
    const { input } = mount(0)
    expect((input as HTMLInputElement).value).toBe("")
  })

  test("stores a typed cap, and anything else as no cap", () => {
    const { set, input } = mount(10)
    expect((input as HTMLInputElement).value).toBe("10")
    fireEvent.change(input, { target: { value: "25" } })
    fireEvent.change(input, { target: { value: "" } })
    expect(set).toEqual([25, 0])
  })
})
