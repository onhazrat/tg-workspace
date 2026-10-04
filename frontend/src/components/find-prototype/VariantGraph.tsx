// PROTOTYPE (find-prototype): variant G, "Graph". Channels as nodes, their
// References as directed edges, walked outward from a start Channel. A pair
// that cites each other both ways is one edge with two arrowheads. Click a node
// for its details, double-click to make it the centre, "Expand" to add its
// neighbours in place; click an edge for every Post that formed it.
// Drawn and simulated by react-force-graph-2d (canvas + d3-force).
import {
  ArrowLeftRight,
  ExternalLink,
  Locate,
  Maximize2,
  Plus,
  Search,
  X,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d"
import { useData } from "@/contexts/DataContext"
import { renderPostText } from "@/lib/posts/render-post-text"
import type { PostLinkSpan } from "@/types"
import {
  Avatar,
  ago,
  type Entry,
  FollowButton,
  fmt,
  Stats,
  TelegramLink,
  usePersistentState,
  useProto,
} from "./shared"

// --- data ----------------------------------------------------------------------

type GNode = Entry & {
  status: string | null
  kind: string | null
  following: boolean
  indeg: number
  outdeg: number
}
/** One pair: `a_to_b` Posts in which a cites b, `b_to_a` the other way. */
type GEdge = {
  a: string
  b: string
  a_to_b: number
  b_to_a: number
  kinds: string[]
}
type Graph = { centre: string; nodes: GNode[]; edges: GEdge[]; ms: number }

type Settings = {
  hops: number
  per_node: number
  min_posts: number
  kinds: string[]
  direction: "both" | "in" | "out"
  /** Leave out handles that are not a live Channel (many are misspellings). */
  live_only: boolean
}
const DEFAULTS: Settings = {
  hops: 1,
  per_node: 15,
  min_posts: 1,
  kinds: [],
  direction: "both",
  live_only: true,
}
const KINDS = ["forward", "mention", "link", "reply"]

type EdgePost = {
  source_channel: string
  target_handle: string
  source_post_id: number
  target_post_id: number | null
  timestamp: number
  kinds: string[]
  text: string | null
  link_spans: PostLinkSpan[] | null
  text_from: "synced" | "sample" | null
}

type Selection =
  | { node: string }
  | { edge: string; dir?: "a_to_b" | "b_to_a" }
  | null
const edgeKey = (e: Pick<GEdge, "a" | "b">) => `${e.a}|${e.b}`

// --- look --------------------------------------------------------------------

const radius = (n?: GNode) =>
  Math.min(26, 5 + 2.6 * Math.log10((n?.subscribers ?? 0) + 1))

function langColour(lang: string | null | undefined) {
  if (!lang) return "hsl(0 0% 55%)"
  const fixed: Record<string, number> = {
    fa: 170,
    ru: 0,
    en: 215,
    uk: 50,
    ar: 30,
    zh: 330,
    de: 270,
  }
  const hue =
    fixed[lang] ?? [...lang].reduce((a, c) => a + c.charCodeAt(0) * 37, 0) % 360
  return `hsl(${hue} 60% 50%)`
}

// --- the variant ---------------------------------------------------------------

export function VariantGraph() {
  const { channels } = useData()
  const [centre, setCentre] = usePersistentState<string>("G.centre", "")
  const [settings, setSettings] = usePersistentState<Settings>(
    "G.settings",
    DEFAULTS,
  )
  const [expand, setExpand] = usePersistentState<string[]>("G.expand", [])
  const [hidden, setHidden] = usePersistentState<string[]>("G.hidden", [])
  const [selection, setSelection] = usePersistentState<Selection>(
    "G.selection",
    null,
  )
  const [trail, setTrail] = usePersistentState<string[]>("G.trail", [])

  const body = useMemo(
    () => ({ centre, ...settings, expand, hidden }),
    [centre, settings, expand, hidden],
  )
  const res = useProto<Graph>(centre ? "/graph" : null, true, body)
  const graph = centre ? res.data : undefined

  const goTo = (handle: string) => {
    const h = handle.replace(/^@/, "").toLowerCase()
    if (!h) return
    setCentre(h)
    setExpand([])
    setSelection({ node: h })
    setTrail((t) => [...t.filter((x) => x !== h), h].slice(-12))
  }

  const yours = useMemo(
    () =>
      [...channels]
        .sort((a, b) => (b.subscribers ?? 0) - (a.subscribers ?? 0))
        .slice(0, 14),
    [channels],
  )

  return (
    <div className="pt-4">
      <div className="space-y-2 rounded-xl border border-app-ink/10 bg-app-card/40 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <StartBox onPick={goTo} />
          <span className="text-app-ink/50">or one of yours</span>
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {yours.map((c) => (
              <button
                type="button"
                key={c.name}
                onClick={() => goTo(c.name)}
                title={`@${c.name}`}
                className={`flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 ${centre === c.name.toLowerCase() ? "bg-app-ink text-app-bg" : "bg-app-ink/5 hover:bg-app-ink/10"}`}
              >
                <Avatar
                  entry={{
                    handle: c.name,
                    display_name: c.displayName ?? null,
                    photo_url: c.photoUrl ?? null,
                  }}
                  size={18}
                />
                <span dir="auto" className="max-w-24 truncate">
                  {c.displayName || c.name}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label="Hops"
            value={String(settings.hops)}
            options={[
              ["1", "1"],
              ["2", "2"],
            ]}
            onChange={(v) => setSettings({ ...settings, hops: Number(v) })}
          />
          <Segmented
            label="Direction"
            value={settings.direction}
            options={[
              ["both", "both"],
              ["in", "cited by"],
              ["out", "cites"],
            ]}
            onChange={(v) =>
              setSettings({
                ...settings,
                direction: v as Settings["direction"],
              })
            }
          />
          <label className="flex items-center gap-1.5">
            <span className="text-app-ink/50">Neighbours per node</span>
            <input
              type="range"
              min={5}
              max={40}
              value={settings.per_node}
              onChange={(e) =>
                setSettings({ ...settings, per_node: Number(e.target.value) })
              }
            />
            <span className="w-5 font-mono">{settings.per_node}</span>
          </label>
          <Segmented
            label="Edge needs ≥"
            value={String(settings.min_posts)}
            options={[1, 2, 3, 5, 10].map((n) => [String(n), `${n}`])}
            onChange={(v) => setSettings({ ...settings, min_posts: Number(v) })}
            suffix="posts"
          />
          <div className="flex items-center gap-1">
            <span className="text-app-ink/50">Kinds</span>
            {KINDS.map((k) => (
              <button
                type="button"
                key={k}
                onClick={() =>
                  setSettings({
                    ...settings,
                    kinds: settings.kinds.includes(k)
                      ? settings.kinds.filter((x) => x !== k)
                      : [...settings.kinds, k],
                  })
                }
                className={`rounded-full px-2 py-0.5 font-mono ${settings.kinds.includes(k) ? "bg-app-ink text-app-bg" : "bg-app-ink/5 hover:bg-app-ink/10"}`}
              >
                {k}
              </button>
            ))}
          </div>
          <label
            className="flex items-center gap-1.5"
            title="Hide handles the Directory has not found to be a live channel; many are misspellings that posts linked to"
          >
            <input
              type="checkbox"
              checked={settings.live_only}
              onChange={(e) =>
                setSettings({ ...settings, live_only: e.target.checked })
              }
            />
            live channels only
          </label>
          <span className="ml-auto font-mono text-[11px] text-app-ink/50">
            {res.isFetching
              ? "loading…"
              : graph
                ? `${graph.nodes.length} channels · ${graph.edges.length} edges · ${graph.ms} ms`
                : ""}
          </span>
        </div>
        {(trail.length > 1 || expand.length > 0 || hidden.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-app-ink/10 pt-2 font-mono text-[11px] text-app-ink/60">
            {trail.length > 1 && (
              <>
                <span>trail</span>
                {trail.map((h) => (
                  <button
                    type="button"
                    key={h}
                    onClick={() => goTo(h)}
                    className={`rounded px-1.5 py-0.5 ${h === centre ? "bg-app-ink text-app-bg" : "hover:bg-app-ink/10"}`}
                  >
                    @{h}
                  </button>
                ))}
              </>
            )}
            {expand.length > 0 && (
              <Chip onClear={() => setExpand([])}>
                expanded {expand.map((h) => `@${h}`).join(", ")}
              </Chip>
            )}
            {hidden.length > 0 && (
              <Chip onClear={() => setHidden([])}>
                hidden {hidden.map((h) => `@${h}`).join(", ")}
              </Chip>
            )}
          </div>
        )}
        {res.error && <p className="text-red-500">{String(res.error)}</p>}
      </div>

      <div className="mt-3 grid grid-cols-[1fr_400px] gap-3">
        {graph ? (
          <Canvas
            graph={graph}
            selection={selection}
            onSelect={setSelection}
            onCentre={goTo}
          />
        ) : (
          <div className="flex h-[calc(100svh-260px)] items-center justify-center rounded-xl border border-dashed border-app-ink/20 text-sm text-app-ink/50">
            {centre && res.isFetching
              ? "Walking the references…"
              : "Pick a channel above to see who it cites and who cites it."}
          </div>
        )}
        <aside className="h-[calc(100svh-260px)] overflow-y-auto rounded-xl border border-app-ink/10 p-4">
          {graph && selection && "edge" in selection ? (
            <EdgePanel
              key={`${selection.edge}|${selection.dir ?? ""}`}
              initialDir={selection.dir ?? "all"}
              graph={graph}
              edge={graph.edges.find((e) => edgeKey(e) === selection.edge)}
              onNode={(h) => setSelection({ node: h })}
            />
          ) : graph && selection && "node" in selection ? (
            <NodePanel
              graph={graph}
              handle={selection.node}
              isCentre={selection.node === graph.centre}
              expanded={expand.includes(selection.node)}
              onCentre={() => goTo(selection.node)}
              onExpand={() =>
                setExpand(
                  expand.includes(selection.node)
                    ? expand.filter((h) => h !== selection.node)
                    : [...expand, selection.node],
                )
              }
              onHide={() => {
                setHidden([...hidden, selection.node])
                setSelection(null)
              }}
              onEdge={(k) => setSelection({ edge: k })}
            />
          ) : (
            <Legend />
          )}
        </aside>
      </div>
    </div>
  )
}

// --- canvas --------------------------------------------------------------------
// react-force-graph-2d draws and simulates; this only says what a node and a
// link look like. Styled after Obsidian's graph: small dots, thin lines,
// labels fading in with zoom, and hovering a node lights its neighbourhood.

type FNode = GNode & {
  id: string
  x?: number
  y?: number
  fx?: number
  fy?: number
}
type FLink = {
  source: string | FNode
  target: string | FNode
  edge: GEdge
  /** Which way this link points: a pair citing both ways becomes two curved links. */
  dir: "a_to_b" | "b_to_a"
  posts: number
}

const idOf = (end: string | FNode) => (typeof end === "string" ? end : end.id)

function themeColours() {
  const css = getComputedStyle(document.documentElement)
  return {
    ink: css.getPropertyValue("--ink").trim() || "#141414",
    bg: css.getPropertyValue("--bg").trim() || "#e4e3e0",
  }
}

function Canvas({
  graph,
  selection,
  onSelect,
  onCentre,
}: {
  graph: Graph
  selection: Selection
  onSelect: (s: Selection) => void
  onCentre: (h: string) => void
}) {
  const fg = useRef<ForceGraphMethods<FNode, FLink> | undefined>(undefined)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [hover, setHover] = useState<string | null>(null)
  const [forces, setForces] = usePersistentState("G.forces", {
    repel: 120,
    distance: 60,
  })
  const fitNext = useRef(true)
  const lastClick = useRef<{ id: string; at: number } | null>(null)
  const nodesById = useRef(new Map<string, FNode>())
  const colours = useMemo(themeColours, [])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The library keeps positions on the node objects, so reuse them across
  // refetches: expanding a node then adds to the picture instead of reshuffling it.
  const data = useMemo(() => {
    const prev = nodesById.current
    const next = new Map<string, FNode>()
    for (const n of graph.nodes)
      next.set(
        n.handle,
        Object.assign(prev.get(n.handle) ?? {}, n, { id: n.handle }),
      )
    nodesById.current = next
    const links: FLink[] = []
    for (const e of graph.edges) {
      if (e.a_to_b > 0)
        links.push({
          source: e.a,
          target: e.b,
          edge: e,
          dir: "a_to_b",
          posts: e.a_to_b,
        })
      if (e.b_to_a > 0)
        links.push({
          source: e.b,
          target: e.a,
          edge: e,
          dir: "b_to_a",
          posts: e.b_to_a,
        })
    }
    return { nodes: [...next.values()], links }
  }, [graph])

  useEffect(() => {
    fitNext.current = true
  }, [graph.centre])

  useEffect(() => {
    const g = fg.current
    if (!g) return
    g.d3Force("charge")?.strength(-forces.repel)
    g.d3Force("link")?.distance(
      (l: FLink) => forces.distance + 30 / Math.sqrt(l.posts),
    )
    g.d3ReheatSimulation()
  }, [forces, data])

  const selNode = selection && "node" in selection ? selection.node : null
  const selEdge = selection && "edge" in selection ? selection.edge : null
  const focus = hover ?? selNode
  const near = useMemo(() => {
    const set = new Set<string>()
    if (!focus) return set
    set.add(focus)
    for (const e of graph.edges)
      if (e.a === focus || e.b === focus) {
        set.add(e.a)
        set.add(e.b)
      }
    return set
  }, [focus, graph])

  const linkHot = (l: FLink) =>
    edgeKey(l.edge) === selEdge ||
    (focus != null && (idOf(l.source) === focus || idOf(l.target) === focus))
  const linkColour = (l: FLink) => {
    if (linkHot(l)) return "#d946ef"
    const two = l.edge.a_to_b > 0 && l.edge.b_to_a > 0
    const faded = focus != null
    if (two) return faded ? "rgba(245,158,11,0.15)" : "rgba(245,158,11,0.85)"
    return faded ? withAlpha(colours.ink, 0.06) : withAlpha(colours.ink, 0.28)
  }

  return (
    <div
      ref={box}
      className="relative h-[calc(100svh-260px)] overflow-hidden rounded-xl border border-app-ink/10"
    >
      <ForceGraph2D<FNode, FLink>
        ref={fg}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        nodeVal={(n) => radius(n) ** 2}
        nodeLabel={(n) =>
          `${n.display_name ?? n.handle} · @${n.handle}\n${fmt(n.subscribers)} subs · ${n.language ?? "?"}${n.status !== "ok" ? `\n${n.status ?? "not in the Directory"}` : ""}`
        }
        nodeCanvasObject={(n, ctx, scale) => {
          const r = radius(n)
          const dim = focus != null && !near.has(n.id)
          const live = n.status === "ok"
          ctx.globalAlpha = dim ? 0.15 : 1
          ctx.beginPath()
          ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI)
          if (live) {
            ctx.fillStyle = langColour(n.language)
            ctx.fill()
          } else {
            ctx.setLineDash([2, 2])
          }
          const ring =
            n.id === selNode
              ? "#d946ef"
              : n.id === graph.centre
                ? colours.ink
                : n.following
                  ? "#10b981"
                  : null
          ctx.lineWidth = (ring ? 2.5 : 1) / Math.sqrt(scale)
          ctx.strokeStyle = ring ?? withAlpha(colours.ink, live ? 0.25 : 0.6)
          ctx.stroke()
          ctx.setLineDash([])
          // Obsidian's trick: labels appear as you zoom in, and always around focus.
          const show =
            near.has(n.id) || n.id === graph.centre
              ? 1
              : Math.min(1, Math.max(0, (scale - 1.1) / 0.8))
          if (show > 0 && !dim) {
            const size = 11 / scale
            ctx.font = `600 ${size}px system-ui, sans-serif`
            ctx.textAlign = "center"
            ctx.textBaseline = "top"
            ctx.globalAlpha = show
            ctx.lineWidth = 3 / scale
            ctx.strokeStyle = colours.bg
            const label = (n.display_name || n.handle).slice(0, 28)
            ctx.strokeText(label, n.x ?? 0, (n.y ?? 0) + r + 2 / scale)
            ctx.fillStyle = colours.ink
            ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + r + 2 / scale)
          }
          ctx.globalAlpha = 1
        }}
        nodePointerAreaPaint={(n, colour, ctx) => {
          ctx.fillStyle = colour
          ctx.beginPath()
          ctx.arc(n.x ?? 0, n.y ?? 0, radius(n) + 2, 0, 2 * Math.PI)
          ctx.fill()
        }}
        linkColor={linkColour}
        linkWidth={(l) =>
          (linkHot(l) ? 1.6 : 0.6) + Math.log2(l.posts + 1) * 0.5
        }
        linkCurvature={(l) =>
          l.edge.a_to_b > 0 && l.edge.b_to_a > 0 ? 0.25 : 0
        }
        linkDirectionalArrowLength={(l) =>
          3.5 + Math.min(4, Math.log2(l.posts + 1))
        }
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={linkColour}
        linkLabel={(l) =>
          `@${idOf(l.source)} → @${idOf(l.target)}: ${l.posts} post${l.posts === 1 ? "" : "s"} (${l.edge.kinds.join(", ")})`
        }
        linkHoverPrecision={6}
        onNodeHover={(n) => setHover(n?.id ?? null)}
        onNodeClick={(n) => {
          // The library has no double-click; two clicks within 350 ms make one.
          const now = Date.now()
          if (
            lastClick.current?.id === n.id &&
            now - lastClick.current.at < 350
          )
            onCentre(n.id)
          else onSelect({ node: n.id })
          lastClick.current = { id: n.id, at: now }
        }}
        onNodeDragEnd={(n) => {
          n.fx = n.x
          n.fy = n.y
        }}
        onLinkClick={(l) => onSelect({ edge: edgeKey(l.edge), dir: l.dir })}
        onBackgroundClick={() => onSelect(null)}
        cooldownTicks={200}
        onEngineStop={() => {
          if (fitNext.current) {
            fitNext.current = false
            fg.current?.zoomToFit(400, 50)
          }
        }}
      />
      <div className="absolute top-2 right-2 w-48 space-y-1.5 rounded-lg border border-app-ink/10 bg-app-bg/90 p-2 text-[11px] shadow-sm">
        <p className="font-semibold text-app-ink/60">Forces</p>
        <Slider
          label="Repel"
          min={20}
          max={600}
          value={forces.repel}
          onChange={(repel) => setForces({ ...forces, repel })}
        />
        <Slider
          label="Link distance"
          min={15}
          max={250}
          value={forces.distance}
          onChange={(distance) => setForces({ ...forces, distance })}
        />
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1">
        <IconButton
          title="Fit to screen"
          onClick={() => fg.current?.zoomToFit(400, 50)}
        >
          <Maximize2 size={14} />
        </IconButton>
        <IconButton
          title="Unpin all and re-run the layout"
          onClick={() => {
            for (const n of data.nodes) {
              n.fx = undefined
              n.fy = undefined
            }
            fitNext.current = true
            fg.current?.d3ReheatSimulation()
          }}
        >
          <Locate size={14} />
        </IconButton>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-app-ink/40">
        drag to pan · wheel to zoom · drag a node to pin it · double-click a
        node to centre it
      </p>
    </div>
  )
}

/** `#rrggbb` (the theme tokens) with an alpha, for canvas strokes. */
function withAlpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(128,128,128,${a})`
  const v = Number.parseInt(m[1], 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="flex justify-between text-app-ink/50">
        {label} <span className="font-mono">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  )
}

// --- panels --------------------------------------------------------------------

function NodePanel({
  graph,
  handle,
  isCentre,
  expanded,
  onCentre,
  onExpand,
  onHide,
  onEdge,
}: {
  graph: Graph
  handle: string
  isCentre: boolean
  expanded: boolean
  onCentre: () => void
  onExpand: () => void
  onHide: () => void
  onEdge: (key: string) => void
}) {
  const node = graph.nodes.find((n) => n.handle === handle)
  const entry = useProto<{ entry: Entry }>(`/entry/${handle}`)
  const bio = entry.data?.entry.bio
  const edges = graph.edges
    .filter((e) => e.a === handle || e.b === handle)
    .map((e) => {
      const other = e.a === handle ? e.b : e.a
      const out = e.a === handle ? e.a_to_b : e.b_to_a
      const inn = e.a === handle ? e.b_to_a : e.a_to_b
      return { e, other, out, inn }
    })
    .sort((x, y) => y.out + y.inn - (x.out + x.inn))
  const name = (h: string) =>
    graph.nodes.find((n) => n.handle === h)?.display_name || h
  if (!node)
    return (
      <p className="text-xs text-app-ink/50">
        @{handle} is no longer in the graph.
      </p>
    )
  return (
    <div className="space-y-3 text-xs">
      <header className="flex items-start gap-3">
        <Avatar entry={node} size={52} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 dir="auto" className="text-base font-bold">
              {node.display_name || node.handle}
            </h3>
            <TelegramLink handle={node.handle} />
          </div>
          <p className="font-mono text-[11px] text-app-ink/50">
            @{node.handle}
          </p>
          <Stats entry={node} />
          {node.status !== "ok" && (
            <p className="text-[11px] text-amber-600">
              {node.status ?? "not in the Directory"}
            </p>
          )}
        </div>
      </header>
      {bio && (
        <p
          dir="auto"
          className="line-clamp-4 whitespace-pre-line text-app-ink/70"
        >
          {bio}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <FollowButton handle={node.handle} />
        {!isCentre && <PanelButton onClick={onCentre}>Make centre</PanelButton>}
        <PanelButton onClick={onExpand}>
          <Plus size={12} /> {expanded ? "Collapse" : "Expand neighbours"}
        </PanelButton>
        {!isCentre && <PanelButton onClick={onHide}>Hide</PanelButton>}
      </div>
      <p className="font-mono text-[10px] text-app-ink/40">
        in the whole Directory: cited by {node.indeg} channels, cites{" "}
        {node.outdeg}
      </p>
      <h4 className="pt-1 text-[11px] font-semibold tracking-wider text-app-ink/50 uppercase">
        Edges in this graph ({edges.length})
      </h4>
      <ul className="space-y-0.5">
        {edges.map(({ e, other, out, inn }) => (
          <li key={edgeKey(e)}>
            <button
              type="button"
              onClick={() => onEdge(edgeKey(e))}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-app-ink/5"
            >
              <span dir="auto" className="min-w-0 flex-1 truncate">
                {name(other)}{" "}
                <span className="font-mono text-app-ink/40">@{other}</span>
              </span>
              <span
                className="shrink-0 font-mono text-[10px] text-app-ink/60"
                title="posts it cites · posts citing it"
              >
                {out > 0 && `→ ${out}`} {inn > 0 && `← ${inn}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EdgePanel({
  graph,
  edge,
  onNode,
  initialDir,
}: {
  initialDir: "all" | "a_to_b" | "b_to_a"
  graph: Graph
  edge?: GEdge
  onNode: (h: string) => void
}) {
  const posts = useProto<{ rows: EdgePost[] }>(
    edge ? `/edge-posts?a=${edge.a}&b=${edge.b}` : null,
  )
  const [dir, setDir] = useState<"all" | "a_to_b" | "b_to_a">(initialDir)
  if (!edge)
    return (
      <p className="text-xs text-app-ink/50">
        This edge is no longer in the graph.
      </p>
    )
  const node = (h: string) => graph.nodes.find((n) => n.handle === h)
  const rows = (posts.data?.rows ?? []).filter(
    (r) =>
      dir === "all" ||
      (dir === "a_to_b"
        ? r.source_channel === edge.a
        : r.source_channel === edge.b),
  )
  const side = (
    from: string,
    to: string,
    n: number,
    key: "a_to_b" | "b_to_a",
  ) => (
    <button
      type="button"
      onClick={() => setDir(dir === key ? "all" : key)}
      disabled={n === 0}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left disabled:opacity-40 ${dir === key ? "bg-app-ink/10" : "hover:bg-app-ink/5"}`}
    >
      <span className="truncate font-mono">@{from}</span>
      <span className="text-app-ink/40">→</span>
      <span className="truncate font-mono">@{to}</span>
      <span className="ml-auto font-semibold">
        {n} post{n === 1 ? "" : "s"}
      </span>
    </button>
  )
  return (
    <div className="space-y-3 text-xs">
      <header>
        <div className="flex items-center gap-2 text-sm font-bold">
          {[edge.a, edge.b].map((h, i) => (
            <span key={h} className="flex min-w-0 items-center gap-1.5">
              {i === 1 && (
                <ArrowLeftRight
                  size={14}
                  className={
                    edge.a_to_b && edge.b_to_a
                      ? "text-amber-500"
                      : "text-app-ink/30"
                  }
                />
              )}
              <button
                type="button"
                onClick={() => onNode(h)}
                className="flex min-w-0 items-center gap-1 hover:underline"
              >
                <Avatar
                  entry={
                    node(h) ?? {
                      handle: h,
                      display_name: null,
                      photo_url: null,
                    }
                  }
                  size={20}
                />
                <span dir="auto" className="truncate">
                  {node(h)?.display_name || h}
                </span>
              </button>
            </span>
          ))}
        </div>
        <p className="mt-1 font-mono text-[10px] text-app-ink/50">
          {edge.a_to_b && edge.b_to_a ? "two-way" : "one-way"} · kinds{" "}
          {edge.kinds.join(", ")}
        </p>
      </header>
      <div className="rounded border border-app-ink/10 p-1">
        {side(edge.a, edge.b, edge.a_to_b, "a_to_b")}
        {side(edge.b, edge.a, edge.b_to_a, "b_to_a")}
      </div>
      <h4 className="text-[11px] font-semibold tracking-wider text-app-ink/50 uppercase">
        Posts forming this edge{dir !== "all" && " (one direction)"}
      </h4>
      {posts.isLoading && <p className="text-app-ink/40">Loading posts…</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={`${r.source_channel}/${r.source_post_id}`}
            className="rounded-md border border-app-ink/10 bg-app-ink/5 p-2"
          >
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-app-ink/50">
              <b className="text-app-ink/80">@{r.source_channel}</b>
              <span>#{r.source_post_id}</span>
              <span>
                {r.kinds.join(" + ")} @{r.target_handle}
                {r.target_post_id ? ` #${r.target_post_id}` : ""}
              </span>
              <span>· {ago(r.timestamp)}</span>
              <a
                href={`https://t.me/s/${r.source_channel}/${r.source_post_id}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-0.5 hover:text-app-ink"
                title="Open the post"
              >
                post <ExternalLink size={10} />
              </a>
              {r.target_post_id && (
                <a
                  href={`https://t.me/s/${r.target_handle}/${r.target_post_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 hover:text-app-ink"
                  title="Open the post it points at"
                >
                  target <ExternalLink size={10} />
                </a>
              )}
            </div>
            {r.text ? (
              <PostBody text={r.text} spans={r.link_spans} />
            ) : (
              <p className="mt-1 text-[11px] text-app-ink/40 italic">
                No stored text: only the post id is known.
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PostBody({
  text,
  spans,
}: {
  text: string
  spans: PostLinkSpan[] | null
}) {
  const [open, setOpen] = useState(false)
  const long = text.length > 280 || text.split("\n").length > 6
  return (
    <>
      <p
        dir="auto"
        className={`mt-1 text-xs leading-relaxed whitespace-pre-line text-app-ink/80 ${long && !open ? "line-clamp-6" : ""}`}
      >
        {renderPostText(text, "", spans)}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-0.5 text-[11px] font-semibold text-app-ink/60 hover:text-app-ink"
        >
          {open ? "Less" : "Read more"}
        </button>
      )}
    </>
  )
}

function Legend() {
  return (
    <div className="space-y-3 text-xs text-app-ink/70">
      <h4 className="text-[11px] font-semibold tracking-wider text-app-ink/50 uppercase">
        Reading the graph
      </h4>
      <ul className="space-y-2">
        <li>
          A node is a channel. Its size is its subscribers, its colour its
          language.
        </li>
        <li>
          <span className="font-semibold text-emerald-600">Green ring</span>:
          you follow it. Dashed outline: unavailable or not checked by the
          Directory.
        </li>
        <li>
          An arrow points from the channel that cites to the channel it cites.
        </li>
        <li>
          <span className="font-semibold text-amber-600">
            Amber, two arrowheads
          </span>
          : the two channels cite each other.
        </li>
        <li>A thicker edge has more posts behind it.</li>
        <li>
          Click a node for its details; click an edge for the posts that formed
          it.
        </li>
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        {["fa", "ru", "en", "uk", "ar", "zh", "de"].map((l) => (
          <span key={l} className="flex items-center gap-1 font-mono">
            <span
              className="size-2.5 rounded-full"
              style={{ background: langColour(l) }}
            />{" "}
            {l}
          </span>
        ))}
        <span className="flex items-center gap-1 font-mono">
          <span
            className="size-2.5 rounded-full"
            style={{ background: langColour(null) }}
          />{" "}
          ?
        </span>
      </div>
    </div>
  )
}

// --- small controls ------------------------------------------------------------

function StartBox({ onPick }: { onPick: (h: string) => void }) {
  const [text, setText] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])
  const hits = useProto<
    {
      handle: string
      display_name: string | null
      subscribers: number | null
      photo_url: string | null
    }[]
  >(
    debounced.replace(/^@/, "").length >= 2
      ? `/lookup?prefix=${encodeURIComponent(debounced)}`
      : null,
  )
  const pick = (h: string) => {
    onPick(h)
    setText("")
    setDebounced("")
  }
  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) pick(text.trim())
      }}
    >
      <Search
        size={14}
        className="absolute top-1/2 left-2.5 -translate-y-1/2 text-app-ink/40"
      />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start from @handle"
        className="w-56 rounded-lg border border-app-ink/20 bg-app-card py-1.5 pr-2 pl-8 font-mono outline-none focus:border-app-ink/60"
      />
      {text.trim().length >= 2 && hits.data && hits.data.length > 0 && (
        <ul className="absolute top-full left-0 z-30 mt-1 w-72 rounded-lg border border-app-ink/15 bg-app-bg p-1 shadow-xl">
          {hits.data.map((h) => (
            <li key={h.handle}>
              <button
                type="button"
                onClick={() => pick(h.handle)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-app-ink/5"
              >
                <Avatar entry={h} size={20} />
                <span dir="auto" className="min-w-0 flex-1 truncate">
                  {h.display_name || h.handle}{" "}
                  <span className="font-mono text-app-ink/40">@{h.handle}</span>
                </span>
                <span className="font-mono text-[10px] text-app-ink/50">
                  {fmt(h.subscribers)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

function Segmented({
  label,
  value,
  options,
  onChange,
  suffix,
}: {
  label: string
  value: string
  options: string[][]
  onChange: (v: string) => void
  suffix?: string
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-app-ink/50">{label}</span>
      {options.map(([v, l]) => (
        <button
          type="button"
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-full px-2 py-0.5 ${value === v ? "bg-app-ink text-app-bg" : "bg-app-ink/5 hover:bg-app-ink/10"}`}
        >
          {l}
        </button>
      ))}
      {suffix && <span className="text-app-ink/50">{suffix}</span>}
    </div>
  )
}

function Chip({
  onClear,
  children,
}: {
  onClear: () => void
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-app-ink/10 py-0.5 pr-1 pl-2">
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear"
        className="rounded-full p-0.5 hover:bg-app-ink/20"
      >
        <X size={10} />
      </button>
    </span>
  )
}

function PanelButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-app-ink/20 px-2.5 py-1 hover:bg-app-ink/5"
    >
      {children}
    </button>
  )
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-md border border-app-ink/15 bg-app-bg p-1.5 text-app-ink/70 shadow-sm hover:text-app-ink"
    >
      {children}
    </button>
  )
}
