/**
 * Plotly for the Requests tab's two charts (RQS-07): the component, and the
 * theme's colours resolved for it. Only the lazily loaded charts import this
 * module, so Plotly downloads only when the tab draws them.
 */
import Plotly from "plotly.js-dist-min"
import { useEffect, useState } from "react"
import createPlotlyComponentModule from "react-plotly.js/factory"
import { KINDS, OUTCOMES } from "@/lib/requests/breakdown"

// The factory is CommonJS; Vite hands it over either bare or as `{ default }`.
const createPlotlyComponent =
  (
    createPlotlyComponentModule as unknown as {
      default?: typeof createPlotlyComponentModule
    }
  ).default ?? createPlotlyComponentModule
export const Plot = createPlotlyComponent(Plotly)

/** Plotly styles its own SVG and cannot read CSS variables, so it gets them resolved. */
const COLOR_VARS: Record<string, string> = {
  line: "--layer-charged",
  uncharged: "--layer-uncharged",
  ink: "--ink",
  axis: "--viz-axis",
  grid: "--viz-grid",
  surface: "--card-bg",
  band: "--account-4",
  ...Object.fromEntries(KINDS.map((k) => [k.id, `--kind-${k.id}`])),
  ...Object.fromEntries(OUTCOMES.map((o) => [o.id, `--outcome-${o.id}`])),
  ledger: "--viz-axis",
}
export type Colors = Record<string, string>

function readColors(): Colors {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(
    Object.entries(COLOR_VARS).map(([k, v]) => [
      k,
      style.getPropertyValue(v).trim(),
    ]),
  )
}

/** The theme's colours, read again when the theme's class on `<html>` changes. */
export function useColors() {
  const [colors, setColors] = useState<Colors | null>(null)
  useEffect(() => {
    setColors(readColors())
    const watch = new MutationObserver(() => setColors(readColors()))
    watch.observe(document.documentElement, { attributeFilter: ["class"] })
    return () => watch.disconnect()
  }, [])
  return colors
}
