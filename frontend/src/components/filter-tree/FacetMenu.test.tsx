/**
 * The shared facet dropdown (PTR-01): a row's count and tick are what the
 * tab says, not something the dropdown computes, and a busy tick cannot be
 * pressed. The Channels counting is tested through `ChannelFacetMenu`.
 */
import { afterEach, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FacetMenu, type FacetMenuRow } from "./FacetMenu"

afterEach(cleanup)

const rows: FacetMenuRow[] = [
  { id: "a", label: "Alpha", selected: 3, total: 3, tick: "true" },
  { id: "b", label: "Beta", selected: 1, total: 4, tick: "mixed" },
  { id: "c", label: "Gamma", selected: 0, total: 9, tick: "false", busy: true },
]

test("rows show the tab's counts and ticks; a busy tick is disabled", () => {
  const picked: string[] = []
  render(
    <FacetMenu
      label="Kinds"
      noun="kind"
      testId="toy"
      rows={rows}
      funnelled={[]}
      labelOf={(id) => id}
      onToggleSelect={(row) => picked.push(row.id)}
      onFunnel={() => {}}
      onClearFunnels={() => {}}
      tickHint="Tick selects every match"
    />,
  )
  expect(screen.getByTestId("toy").textContent).toBe("Kinds2")
  fireEvent.click(screen.getByTestId("toy"))
  expect(screen.getByText("Tick selects every match")).toBeTruthy()
  expect(
    rows.map((row) => [
      screen.getByTestId(`toy-row-${row.id}`).getAttribute("aria-checked"),
      screen.getByTestId(`toy-count-${row.id}`).textContent,
    ]),
  ).toEqual([
    ["true", "3/3"],
    ["mixed", "1/4"],
    ["false", "0/9"],
  ])
  fireEvent.click(screen.getByTestId("toy-row-c"))
  fireEvent.click(screen.getByTestId("toy-row-b"))
  expect(picked).toEqual(["b"])
})
