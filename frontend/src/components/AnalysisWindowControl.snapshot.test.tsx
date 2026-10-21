/**
 * The Posts tab's Analysis window editor, frozen as markup (TB-01).
 *
 * ADR-033 splits this editor into pieces every other time filter reuses, and
 * promises the Posts tab looks exactly as it did. This snapshot was taken on
 * the code before the split. Never update it: a diff here is the Posts editor
 * changing, which the ticket forbids.
 *
 * Local-time instants are scrubbed, so the snapshot holds in any time zone,
 * and React's ids are renumbered from 1 per snapshot: client-rendered ids
 * count up across the whole test file, so they would move with test order.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

import {
  AnalysisWindowControl,
  WindowHistogramContext,
} from "@/components/AnalysisWindowControl"
import { ScopeProvider } from "@/contexts/ScopeContext"

const NOW = Date.UTC(2026, 8, 11, 14, 30)

function scrub(html: string) {
  const ids = new Map<string, string>()
  return html
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g, "<local-minute>")
    .replace(/_r_[0-9a-z]+_/g, (id) => {
      if (!ids.has(id)) ids.set(id, `id${ids.size + 1}`)
      return ids.get(id) as string
    })
}

const setWidth = (px: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px })
}

/** Posts counts for the chart: one per bucket, so every bar is drawn. */
const counts = () => Array.from({ length: 60 }, (_, i) => i % 7)

function renderOpen(chart = false) {
  const control = <AnalysisWindowControl />
  render(
    <ScopeProvider clock={() => NOW}>
      {chart ? (
        <WindowHistogramContext.Provider value={counts}>
          {control}
        </WindowHistogramContext.Provider>
      ) : (
        control
      )}
    </ScopeProvider>,
  )
  const trigger = screen.getByRole("button", { name: "Analysis window" })
  const collapsed = scrub(trigger.outerHTML)
  act(() => {
    fireEvent.click(trigger)
  })
  return { collapsed, opened: scrub(document.body.innerHTML) }
}

beforeEach(() => localStorage.clear())

afterEach(() => {
  cleanup()
  setWidth(1024)
})

describe("the Posts Analysis window editor's markup", () => {
  test("desktop: the collapsed line and its open popover", () => {
    setWidth(1024)
    const { collapsed, opened } = renderOpen()
    expect(collapsed).toMatchSnapshot("desktop collapsed")
    expect(opened).toMatchSnapshot("desktop popover")
  })

  test("desktop: the popover with the Posts time chart and its zoom", () => {
    setWidth(1024)
    expect(renderOpen(true).opened).toMatchSnapshot("desktop popover chart")
  })

  test("phone: the collapsed line and its bottom sheet", () => {
    setWidth(420)
    const { collapsed, opened } = renderOpen()
    expect(collapsed).toMatchSnapshot("phone collapsed")
    expect(opened).toMatchSnapshot("phone sheet")
  })
})
