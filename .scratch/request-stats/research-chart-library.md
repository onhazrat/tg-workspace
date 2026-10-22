# Research: one React chart library for the app

Date: 2026-10-22. Question: which chart library should the frontend adopt as its only one, first for the Operator-only Requests tab prototype and later for charts across the app. Sources are the libraries' own docs, GitHub repos and issues, the npm registry, and bundlephobia. Where no source answered a question I measured it myself in a throwaway directory (`/private/tmp/claude-501/chartprobe`, nothing installed into the repo). Every probe command is listed under "How the numbers were made" at the end.

## Recommendation

Adopt **Recharts 3** through **shadcn/ui's Chart component**. It is the only candidate that fits how this frontend already works. The repo is shadcn `new-york` with `cssVariables: true` (`frontend/components.json`), and `frontend/src/index.css` already defines `--chart-1` to `--chart-5` for light and dark. shadcn's Chart is a copy-in file that uses Recharts directly and themes it through those same CSS variables. Recharts has native Sankey, Treemap, Brush, stacked Area, Bar and log scales, a React 19 peer range, and by far the most active maintenance of the field (8 stable releases in 2026, a canary on 2026-10-13, 106 issues opened and 77 closed in the last 90 days).

What Recharts lacks, and what you should plan around. It has no heatmap (the hour-of-day x weekday chart needs a ScatterChart with square custom shapes, or a different chart). It is not small (about 131 KB gzip for the Requests tab's set, 86 KB for a bare line chart). Each instance builds its own Redux store and about 22 DOM nodes, which matters for hundreds of sparklines. And its ResponsiveContainer renders nothing under happy-dom, so unit tests must give charts a fixed size.

Runner-up: **Apache ECharts 6** (through `echarts/core` plus a thin wrapper). It natively covers every chart on both lists, heatmap and dataZoom included, with ARIA descriptions and decal patterns. It loses on fit: about 243 KB gzip for the Requests set, an imperative options API outside React, no built-in way to read CSS variables on its default canvas renderer, and a React wrapper with an open React 19 types issue. The call is close only on chart coverage, which is why the A/B below pits these two against each other.

## Comparison table

Support key: **yes** is a built-in chart type or prop, **plugin** is an official or first-party extra package, **custom** means you assemble it from the library's primitives or a custom render callback, **no** means not supported. Sizes are min+gzip from my esbuild probe with React external. "Requests set" is stacked area, bar, brush, tooltip, axes, Sankey, treemap (plus heatmap where native). "Sparkline" is the smallest import that draws one line.

| | Recharts 3 | ECharts 6 | Nivo 0.99 | visx 4 | Unovis 1.7 | Victory 37 | Chart.js 4 | Plot 0.6 | uPlot 1.6 |
|---|---|---|---|---|---|---|---|---|---|
| Latest stable | 3.10.1, 2026-07-25 | 6.1.0, 2026-05-19 | 0.99.0, 2025-05-23 | 4.0.0, 2026-06-11 | 1.7.1, 2026-09-29 | 37.3.6, 2025-01-14 | 4.5.1, 2025-10-13 | 0.6.17, 2025-02-14 | 1.6.32, 2025-03-14 |
| React 19 peer | yes | n/a (wrapper `react >=16`) | yes | yes (18 or 19 only) | yes | `>=16.6` | wrapper yes | n/a (no React API) | wrapper `>=16.8.6` |
| Renders | SVG | canvas or SVG | SVG (some canvas variants) | SVG | SVG | SVG | canvas | SVG | canvas |
| Gzip, Requests set | 131 KB | 243 KB | 134 KB | 41 KB | 94 KB | 93 KB (no Sankey, treemap) | 86 KB (with plugins) | 97 KB (no Sankey, treemap) | n/a |
| Gzip, sparkline | 86 KB | 148 KB | 98 KB | 14 KB | 50 KB | 66 KB | 48 KB | 94 KB | 24 KB |
| Ranked table with inline bars | custom | custom | custom | custom | custom | custom | custom | custom | no |
| Stacked area, click a day | yes | yes | yes | custom | yes | yes | yes | yes | yes |
| Range brushing | yes (Brush) | yes (dataZoom, brush) | no | plugin (@visx/brush) | yes (Brush) | yes (brush container) | plugin (zoom) | no | yes (drag zoom) |
| Sankey | yes | yes | plugin (@nivo/sankey) | plugin (@visx/sankey) | yes | no | plugin (third-party chartjs-chart-sankey) | no | no |
| Nested treemap, colour by value | yes (custom tile renderer) | yes | plugin (@nivo/treemap) | plugin (@visx/hierarchy) | yes | no | plugin (chartjs-chart-treemap) | no | no |
| Bar, histogram | yes, pre-binned | yes, pre-binned | yes, pre-binned | custom | yes, pre-binned | yes, histogram | yes, pre-binned | yes (binX) | bars only |
| Heatmap (hour x weekday) | no (custom via Scatter) | yes | plugin (@nivo/heatmap) | plugin (@visx/heatmap) | yes | no | plugin (chartjs-chart-matrix) | yes (cell) | no |
| Log scale | yes | yes | yes | yes | yes (d3 scale) | yes | yes | yes | yes |
| Dashed projected segment | yes (second series) | yes (second series) | custom (layer) | yes (second path) | yes (lineDashArray) | yes (second series) | yes (per-segment style) | yes (second mark) | yes (series dash) |
| Theme via CSS variables | yes, shadcn wires it | SVG renderer passes `var()`; canvas needs resolved colours | theme object of strings | yes (your own SVG props) | yes, its own `--vis-*` variables | style props | no (canvas) | yes (SVG) | no (canvas) |
| Keyboard / ARIA | keyboard + ARIA by default (accessibilityLayer) | generated aria-label, decals; no keyboard | role and aria props on some charts | none built in | aria-label on container | none built in | you add role and label to the canvas | none built in | none built in |
| happy-dom (`bun test`) | renders with fixed size; ResponsiveContainer renders nothing | renders with SVG renderer | renders | renders | renders with errors (Sankey) | renders | fails, no canvas context | not probed | throws, no canvas context |
| DOM nodes per sparkline | 22 | 10 | 5 | 2 | 14 | 9 | 1 (canvas) | not probed | 1 (canvas) |
| npm downloads, week of 2026-10-12 | 33.3M | 3.6M | 0.85M | 4.1M | 0.15M | 0.23M | 7.1M | 0.68M | 0.42M |

Excluded early, with the reason. **Tremor** builds on Recharts 2 and React 18 (details below). **MUI X Charts** puts Sankey, heatmap and zoom in the paid Pro plan and needs `@mui/material` and Emotion. **ApexCharts** charges organisations at or above USD 2M revenue and requires an OEM licence for "embedding in a product or platform used by other people", which a published self-hosted app may trip.

## Per-library notes

### Recharts 3 (and shadcn/ui Chart)

Versions and React 19. `recharts@3.10.1` is latest, with `3.11.0-canary.6` on the canary tag; peers are `react`, `react-dom` and `react-is` at `^16.8.0 || ... || ^19.0.0` (`npm view recharts version dist-tags peerDependencies`). It depends on `@reduxjs/toolkit`, `react-redux`, `immer`, `reselect` and `victory-vendor` (same command). The bun-specific breakage in [recharts#5562](https://github.com/recharts/recharts/issues/5562) was a 3.0 alpha pulling a React-19-incompatible react-redux; the maintainer fixed it with an `overrides` entry and promised a fix before 3.0. My probe install with bun resolved `react-redux@9.3.0`, whose peer range includes React 19, and rendered without warnings. Still open and relevant: [#6117](https://github.com/recharts/recharts/issues/6117) and [#6316](https://github.com/recharts/recharts/issues/6316), CJS/ESM interop failures of the bundled Redux toolkit under Next.js. They do not apply to a Vite SPA but show the dependency weight. [#7341](https://github.com/recharts/recharts/issues/7341) asks to drop the `react-is` peer; the repo does not install `react-is` today.

Maintenance. 239 stable releases, 8 in 2026, latest stable 2026-07-25, repo pushed 2026-10-22 (`npm view recharts time`, `gh api repos/recharts/recharts`). In the 90 days from 2026-07-24, 106 issues were opened and 77 closed, with 428 open in total (GitHub search API). The issue tracker is busy and the maintainers close issues.

shadcn Chart. The docs say "We do not wrap Recharts" and that the component "now uses Recharts v3" ([ui.shadcn.com/docs/components/chart](https://ui.shadcn.com/docs/components/chart)). The registry item pins `recharts@3.8.0` (`curl https://ui.shadcn.com/r/styles/new-york-v4/chart.json`), one minor behind latest. It ships `ChartContainer`, `ChartTooltip`/`ChartTooltipContent`, `ChartLegend`/`ChartLegendContent` and the `ChartConfig` type. Colours come from a config object whose values can be `var(--chart-1)` or a `{ light, dark }` pair, and `ChartStyle` writes them out as `--color-<key>` scoped to `[data-chart=<id>]` and `.dark [data-chart=<id>]` ([source, chart.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/chart.tsx)). The `.dark` selector matches next-themes' class strategy. The v3 notes on the same page say to use `var(--chart-1)` rather than `hsl(var(--chart-1))` and to keep a height or aspect class on `ChartContainer` so `ResponsiveContainer` can measure.

Chart types. The API index lists AreaChart, BarChart, LineChart, ComposedChart, ScatterChart, FunnelChart, Treemap, Sankey and SunburstChart, plus Brush, ReferenceArea and ZAxis, and no heatmap or zoom component ([recharts.github.io/en-US/api](https://recharts.github.io/en-US/api/)). Treemap takes nested `children` in its data, has `type="flat" | "nest"` (nest gives zoom-in with breadcrumbs) and a `content` renderer for per-tile fill, which is how waste-share colouring works ([Treemap API](https://recharts.github.io/en-US/api/Treemap/)). Brush is an index-range slider under the x axis with `startIndex`/`endIndex` ([Brush API](https://recharts.github.io/en-US/api/Brush/)); `onChange` and `onDragEnd` are typed in `types/cartesian/Brush.d.ts`. Drag-to-select on the plot itself needs ReferenceArea and mouse handlers. Axes take `scale="log"` or any d3 scale object ([YAxis API](https://recharts.github.io/en-US/api/YAxis/)). A dashed projected segment is a second `<Line strokeDasharray>` series that shares the join point.

Open Sankey and Treemap bugs worth knowing for the prototype: tooltip `defaultIndex` never positions on Sankey or Treemap ([#8036](https://github.com/recharts/recharts/issues/8036), [#8034](https://github.com/recharts/recharts/issues/8034)), Sankey touch never shows a tooltip ([#8044](https://github.com/recharts/recharts/issues/8044)), node labels need a custom node renderer ([#8042](https://github.com/recharts/recharts/issues/8042)), and layout freezes on dense branching graphs of 85 nodes and 112 links ([#7478](https://github.com/recharts/recharts/issues/7478)). The Requests Sankey has three layers and about ten nodes, so #7478 should not bite.

Accessibility. The 3.0 migration guide says of `accessibilityLayer`: "in 3.0 it's true by default" ([wiki](https://github.com/recharts/recharts/wiki/3.0-migration-guide)). In my probe the default root renders `<svg role="application" tabindex="0">`. That is right for a big chart and wrong for sparklines: 300 cards would add 300 tab stops, which collides with the app's Keyboard mode. Pass `accessibilityLayer={false}` on sparklines. One open keyboard bug: [#7905](https://github.com/recharts/recharts/issues/7905).

Test environments. With a numeric `width`/`height` the chart renders in happy-dom (1 svg, paths present). `ResponsiveContainer width="100%"`, even with `initialDimension`, renders an empty div because happy-dom has no layout, so a test of shadcn's `ChartContainer` sees no SVG. `renderToString` returns only the wrapper div with no paths: Recharts 3 draws after mount. Playwright runs a real browser, so neither limit applies there.

Per-instance cost. `RechartsStoreProvider` calls `createRechartsStore` once per chart (`es6/state/RechartsStoreProvider.js` line 36). In happy-dom, 300 fixed-size LineCharts took 429 ms and made 22 DOM nodes each, the heaviest of the SVG libraries probed. happy-dom timings are only relative. For sparklines, skip `ChartContainer` (it adds a `<style>` element and a ResizeObserver per instance), use a fixed-size `LineChart`, `isAnimationActive={false}` and `accessibilityLayer={false}`, and colour with `stroke="var(--chart-1)"`.

Types: TypeScript source, `types/index.d.ts`. License MIT.

### Apache ECharts 6 (with echarts-for-react or a direct wrapper)

Versions. `echarts@6.1.0` (2026-05-19), one stable release a year since 2024; `6.0.0` was 2025-07-30 (`npm view echarts time`). The repo is very active: 174 issues closed and 28 opened in 90 days, 1,273 open (GitHub search API). Apache-2.0.

React. ECharts has no React layer. `echarts-for-react@3.0.6` peers on `react ^15.0.0 || >=16.0.0` and `echarts ^3 ... ^6` (`npm view`). Its registry has a `3.0.7` that the `latest` tag does not point at. Open: [#628](https://github.com/hustcc/echarts-for-react/issues/628) (React 19 types, "cannot find namespace JSX") and [#619](https://github.com/hustcc/echarts-for-react/issues/619) (CJS interop). The README documents tree-shaking with `echarts/core` plus `echarts-for-react/lib/core`, `opts={{ renderer: 'svg' }}`, a `theme` prop and `onEvents` ([README](https://github.com/hustcc/echarts-for-react)). The wrapper is about 3.6 KB gzip (bundlephobia), so writing a 40-line `useEffect` wrapper instead is reasonable.

Chart types. Everything needed is native: line or area with stacking, bar, sankey, treemap (with drill-down), heatmap, `dataZoom` (slider and inside), `brush`, `visualMap`, and a `log` axis type (`AxisScaleType = 'ordinal' | 'interval' | 'log' | 'time'` in [axisCommonTypes.ts](https://github.com/apache/echarts/blob/master/src/coord/axisCommonTypes.ts)). Version 6 adds runtime theme switching without re-init and dark mode via `setTheme` ([v6 features](https://echarts.apache.org/handbook/en/basics/release-note/v6-feature/)).

Theming. ECharts takes colour strings in its options. The v6 notes say nothing about CSS variables. On the canvas renderer `var(--x)` cannot resolve, so you read `getComputedStyle` and call `setTheme` or `setOption` when next-themes flips. In my probe the SVG renderer wrote `fill="var(--chart-1)"` through unchanged; whether hover emphasis, which derives colours, survives a `var()` is untested.

Accessibility. `aria.enabled` generates an `aria-label` description and `aria.decal` adds patterns for colour-blind readers; the page does not mention keyboard navigation ([aria guide](https://echarts.apache.org/handbook/en/best-practices/aria/)).

Size and tests. The Requests set is 243 KB gzip and a bare SVG line chart is 148 KB, the largest of the field. The package is 60 MB unpacked (`npm view echarts dist.unpackedSize`). With the SVG renderer it renders in happy-dom (Sankey: 19 paths, no errors; 300 sparklines: 10 nodes each, 162 ms). Types are bundled (`types/dist/echarts.d.cts`).

### Nivo 0.99

React 19 peer `^16.14 || ... || ^19.0` (`npm view @nivo/core`); [#2678](https://github.com/plouc/nivo/issues/2678) (React 19 support) is closed. The last release was 0.99.0 on 2025-05-23, seventeen months ago, after a burst of six releases that May (`npm view @nivo/core time`, [releases](https://github.com/plouc/nivo/releases)). The repo still takes merges (last commit 2026-07-21, Sunburst ARIA attributes 2026-06-29), but in 90 days 2 issues were opened and none closed, and the [brush request](https://github.com/plouc/nivo/issues/2278) was closed as stale. Treat it as slow-moving.

Each chart is its own package: `@nivo/sankey`, `@nivo/treemap`, `@nivo/heatmap`, `@nivo/line`, `@nivo/bar`, `@nivo/stream` (`npm view`). Scales are linear, band, log and symlog ([scales guide](https://nivo.rocks/guides/scales/)). There is no brush or zoom; an open draft for scatter zoom is [#2846](https://github.com/plouc/nivo/issues/2846). A dashed projected segment needs a custom `layers` entry; the Line types expose `layers` and no dash prop (`dist/types/types.d.ts`). Theming is a `theme` object merged with the default ([theming guide](https://nivo.rocks/guides/theming/)), which says nothing about CSS variables. The values are strings, so SVG charts should accept `var()`, but I did not verify that. Sankey exposes `role`, `ariaLabel` and `ariaLabelledBy` props. Sizes: 134 KB gzip for the set, 98 KB for one Line, because every chart pulls `@nivo/core`, react-spring and lodash. Renders in happy-dom; 5 nodes per sparkline.

### visx 4

`@visx/*@4.0.0` was released 2026-06-11 with "React 19 Support" and "Breaking: Require React 18 or 19" ([releases](https://github.com/airbnb/visx/releases)). Before that the last stable was 3.12.0 in 2024-11, so the cadence is slow (`npm view @visx/shape time`). 4 issues opened and none closed in 90 days.

The README calls visx "a collection of reusable low-level visualization components" that is "largely unopinionated and is meant to be built upon" ([README](https://github.com/airbnb/visx)). Packages exist for everything on the list: `@visx/sankey` (added in 3.12.0), `@visx/hierarchy` (treemap), `@visx/heatmap`, `@visx/brush`, `@visx/zoom`, `@visx/scale` (log included) and `@visx/xychart` (`npm view`). You still write axes placement, tooltips, legends, hit testing and layout yourself, which comes close to the user's "never hand-roll chart machinery" rule. It is the lightest by far: 41 KB gzip for the set, 14 KB for a sparkline (`LinePath` + `scaleLinear`), 2 DOM nodes per sparkline, 62 ms for 300 in happy-dom. Colours are whatever you put on the SVG props, so `var()` works. No built-in ARIA. `sideEffects: false`, TypeScript types bundled.

### Unovis 1.7 (added contender)

F5's library, `@unovis/react@1.7.1` peers on React `^19` among others; 6 stable releases in 2026, latest 2026-09-29; 9 issues opened and 9 closed in 90 days (`npm view`, GitHub search API). Components include Line, Area, Stacked Bar, Brush, Free Brush, Crosshair, Heatmap, Sankey, Treemap, Graph and Timeline ([intro](https://unovis.dev/docs/intro)). It themes through its own CSS variables (`--vis-color0`, `--vis-dark-color0`, per-component ones like `--vis-area-stroke-width`), and dark mode keys on a `theme-dark` class on `body` ([theming guide](https://unovis.dev/docs/guides/theming)). That does not match next-themes' `.dark` on `html`, but mapping `--vis-color0: var(--chart-1)` inside the app's own `:root` and `.dark` blocks avoids the class. Line and Area type a `lineDashArray` accessor and Line has `interpolateMissingData` (`components/line/config.d.ts`). The container takes `ariaLabel`.

Costs. `@unovis/ts` depends on three, leaflet, maplibre-gl and elkjs, so the install is large (`npm view @unovis/ts dependencies`), but tree-shaking dropped all of them from my bundle: 94 KB gzip for the set, 50 KB for a sparkline. In happy-dom the Sankey rendered but logged 10 errors (`svgNode.transform.baseVal.consolidate is not a function`, a happy-dom gap), which would need a test shim. 14 nodes per sparkline. Adoption is small (0.15M weekly downloads), so fewer answers exist outside its docs. It is a credible plan C, not a pick.

### Victory 37

Peer `react >=16.6.0`; last release 37.3.6 on 2025-01-14, repo last pushed 2025-12-19 (`npm view victory`, `gh api`). The README badge still says "maintenance-active" ([README](https://github.com/FormidableLabs/victory#maintenance-status)). React 19 issues [#3076](https://github.com/FormidableLabs/victory/issues/3076) and [#3048](https://github.com/FormidableLabs/victory/issues/3048) are closed. The umbrella package lists area, bar, histogram, brush, zoom and voronoi packages and no Sankey, treemap or heatmap (`npm view victory dependencies`), so it fails the "now" list. 93 KB gzip for what it can do.

### Chart.js 4 with react-chartjs-2 5

`chart.js@4.5.1` (2025-10-13), `react-chartjs-2@5.3.1` peers `react ^16.8 ... ^19.0` (`npm view`); [#1238](https://github.com/reactchartjs/react-chartjs-2/issues/1238), React 19 missing from peers, is closed. Sankey, treemap, heatmap (matrix) and zoom are separate plugins: `chartjs-chart-sankey@0.19.1`, `chartjs-chart-treemap@4.2.2`, `chartjs-chart-matrix@3.1.0`, `chartjs-plugin-zoom@2.2.0`, all updated in 2025 or 2026 (`npm view`). Per-segment line styling is native, with `borderDash` per segment ([segments sample](https://www.chartjs.org/docs/latest/samples/line/segments.html)), which suits the projected segment. It draws on canvas, so CSS variables need resolving in JS, and the accessibility page says "it is up to the user to create the canvas element in a way that is accessible" ([accessibility](https://www.chartjs.org/docs/latest/general/accessibility.html)). In happy-dom every chart failed with "can't acquire context from the given item". 86 KB gzip with all four plugins, 48 KB for a line.

### Tremor

`@tremor/react@3.18.7` (2025-01-13) peers on `react ^18.0.0` and depends on `recharts ^2.13.3` (`npm view @tremor/react`), and its repo was last pushed the same day. The current copy-paste "Tremor Raw" repo declares `react ^18.3.1` and `recharts ^2.15.2`, and its last code change was a Tailwind v4 update on 2025-04-12 ([package.json](https://github.com/tremorlabs/tremor/blob/main/package.json), commits). Recharts' own tracker says v2 no longer receives updates ([#7361](https://github.com/recharts/recharts/issues/7361)). shadcn's Chart covers the same ground on Recharts 3. Not a candidate.

### Observable Plot 0.6

`@observablehq/plot@0.6.17` (2025-02-14), one release in 2025 and none in 2026 (`npm view`). No React API. The docs recommend either rendering with the `document` option into React's virtual DOM or a `useRef` + `useEffect` wrapper that removes and recreates the plot on every change ([getting started](https://github.com/observablehq/plot/blob/main/docs/getting-started.md)). Brushing "is under development" and zoom "is planned for a future release" ([interactions](https://github.com/observablehq/plot/blob/main/docs/features/interactions.md)). No Sankey or treemap mark. Strong for histograms (`binX`) and heatmaps (`cell`), weak for the Requests tab. About 94 KB gzip even for one line, because it pulls all of d3.

### uPlot 1.6

`uplot@1.6.32` (2025-03-14). The README describes "a fast, memory-efficient Canvas 2D-based chart for plotting time series, lines, areas, ohlc & bars" at "~50 KB", lists logarithmic scales and "Zoom with auto-rescale", and says there is "No built-in drag scrolling/panning" ([README](https://github.com/leeoniya/uPlot)). It has a sparklines demo ([demo](https://leeoniya.github.io/uPlot/demos/sparklines.html)). 24 KB gzip with `uplot-react`. Canvas, so no CSS variables and no ARIA, and in happy-dom it throws on `ctx.clearRect` because there is no 2D context. It only does time series, so it cannot be the single library; it would only matter as a sparkline engine if SVG proved too slow.

## No clear winner? What to A/B

On the charts needed now, Recharts and ECharts both cover the list natively, and the rest either miss Sankey or treemap (Victory, Plot, uPlot), have stalled releases (Nivo, Tremor), or make you build the chart (visx). So the A/B is **Recharts 3 (via shadcn Chart) against ECharts 6 (SVG renderer, `echarts/core`)**, on two charts.

1. **The Sankey (Charged/Uncharged, then kind of work, then useful/Idle/Waste).** This is where Recharts is weakest: node labels need a custom renderer, and four open bugs touch Sankey tooltips and touch input. ECharts' Sankey has labels, adjacency highlighting and node alignment built in. Build the same Sankey in both, themed from `--chart-*` in light and dark, with hover tooltips and click-to-filter. Recharts passes if labels, tooltips and theme switching work without fighting the library. If it fails, ECharts' coverage is worth its 110 KB extra.

2. **300 sparklines in a `@tanstack/react-virtual` list, measured in Chromium (Playwright trace), not happy-dom.** Compare a fixed-size Recharts `LineChart` (no ChartContainer, `accessibilityLayer={false}`, no animation) with an ECharts SVG instance per card, on scroll frame time and on mount time per row. My happy-dom numbers (Recharts 22 nodes and a Redux store per chart, ECharts 10 nodes and a zrender instance per chart) suggest neither is free. If both blow the frame budget, keep the winner of test 1 for everything else and question the single-library rule for sparklines only, where `@visx/shape`'s `LinePath` is 14 KB and 2 nodes. I would rather raise that than ship a janky list.

Run test 1 first; it alone decides the Requests tab prototype. Test 2 decides only the later list-card work and can wait.

## How the numbers were made

- npm metadata: `npm view <pkg> version time dist-tags peerDependencies dependencies dist.unpackedSize license --json` for each package named above, run 2026-10-22. Release cadence counts stable versions (no `-` suffix) per year from `time`.
- Downloads: `https://api.npmjs.org/downloads/point/last-week/<pkg>` (week 2026-10-12 to 2026-10-18).
- GitHub: `gh api repos/<owner>/<repo>` for stars, push date, archive flag; issue trend from `gh api search/issues -f q="repo:<r> is:issue created:>=2026-07-24"` and `closed:>=2026-07-24`; issue texts with `gh issue view`.
- Bundle sizes: in `/private/tmp/claude-501/chartprobe`, `bun add` of the listed versions, then one entry file per library and scenario re-exporting only what is needed, bundled with `esbuild --bundle --minify --format=esm --external:react --external:react-dom --define:process.env.NODE_ENV='"production"'` and measured with `gzip -9 | wc -c`. Bundlephobia's whole-package numbers (for example `echarts@6.1.0` 368 KB gzip, `chart.js@4.5.1` 68 KB, `@visx/shape@4.0.0` 11 KB, `uplot@1.6.32` 22 KB) agree in order of magnitude but do not reflect tree-shaking, so the table uses the esbuild figures.
- happy-dom: `bun test` with `@happy-dom/global-registrator@20.11.1` preloaded (the repo's version), React 19.2.7, `createRoot` + `act`. One test mounts 300 sparklines per library and counts DOM nodes, another mounts an 8-node, 11-link Sankey, a third checks `ResponsiveContainer` and `renderToString`. Timings are for comparison between libraries only.
