import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { Link } from "@tanstack/react-router"
import {
  Activity,
  Compass,
  Database,
  FileText,
  History,
  List,
  MessageSquare,
  Plus,
  Send,
  Settings,
  Sparkles,
  Tag,
  Telescope,
  X,
  Zap,
} from "lucide-react"
import type { KeyboardEventHandler } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WORKSPACE_TABS } from "@/constants"
import type { WorkspaceTabs } from "@/hooks/useWorkspaceTabs"
import { isFixed, type Tab, tabKey, tabSearch } from "@/lib/workspace-tabs"

import { tabAnnouncements, tabPresentation } from "./workspace-shell-model"

const TAB_ICONS = {
  Database,
  List,
  MessageSquare,
  History,
  Send,
  Settings,
  Sparkles,
  FileText,
  Activity,
  Tag,
  Compass,
  Telescope,
  Zap,
}

function tabIcon(meta: (typeof WORKSPACE_TABS)[number]) {
  return TAB_ICONS[meta.icon as keyof typeof TAB_ICONS] ?? Database
}

/** What the "+" menu offers: every kind that can be closed. */
const CLOSABLE_TABS = WORKSPACE_TABS.filter((tab) => !isFixed(tab.id))

/**
 * Space picks a tab up, as the spec asks. Not Enter: on a link Enter follows
 * it, and taking it for the drag would leave keyboard users unable to switch
 * tabs. Mid-drag Enter drops instead, so it cannot follow a link while the
 * drag is still live.
 */
const KEYBOARD_CODES = {
  start: ["Space"],
  cancel: ["Escape"],
  end: ["Space", "Enter"],
}

/**
 * Cancel the click that ends a mouse drag.
 *
 * dnd-kit stops that click's propagation, which also keeps it from the Link's
 * handler, so the anchor's default ran and the drop reloaded the whole page.
 * Held for the 50ms dnd-kit holds its own listener. A keyboard drop has no
 * click to cancel, and an Enter pressed straight after it must still work.
 */
// ponytail: mirrors dnd-kit's 50ms hold; if dnd-kit changes it, match it here.
function cancelDropClick(activator: Event) {
  if (activator instanceof KeyboardEvent) return
  const cancel = (event: MouseEvent) => event.preventDefault()
  window.addEventListener("click", cancel, { capture: true, once: true })
  setTimeout(() => window.removeEventListener("click", cancel, true), 50)
}

/**
 * The workspace tab strip (TABS-01, TABS-02).
 *
 * Real links, not buttons with click handlers. These are URL-addressable
 * views, so as `<button onClick>` they were unreachable by the things links
 * give you free: middle-click, open-in-new-tab, "copy link address", and an
 * announced destination.
 *
 * `aria-current="page"` rather than `role="tab"`: the ARIA tab pattern obliges
 * a roving tabindex and arrow-key navigation, and claiming the role without
 * implementing those leaves assistive-tech users worse off than plain links.
 * A `<nav>` of links marking the current one is honest about what this is.
 *
 * `replace` preserves the previous behaviour: tab switches did not stack
 * history entries, and still do not.
 *
 * Closable tabs reorder with `@dnd-kit`, because native HTML drag-and-drop
 * does not fire reliably on touch. The mouse needs a 5px move so a click is
 * still a click; touch needs a 250ms hold so a swipe still scrolls the strip.
 * Only Closable tabs are sortable, so nothing drops before the Fixed ones.
 */
export function WorkspaceTabStrip({
  workspaceTabs,
}: {
  workspaceTabs: WorkspaceTabs
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: KEYBOARD_CODES,
    }),
  )
  const { tabs } = workspaceTabs
  const closable = tabs.filter((tab) => !isFixed(tab.kind))
  const byKey = new Map(tabs.map((tab) => [tabKey(tab), tab]))
  const views = tabs.map((tab, index) =>
    tabPresentation(
      tab,
      index,
      tabs,
      workspaceTabs.active,
      workspaceTabs.artifactFor(tab),
    ),
  )
  const labels = new Map(views.map((view) => [view.key, view.label]))

  const onDragEnd = ({ active, over, activatorEvent }: DragEndEvent) => {
    cancelDropClick(activatorEvent)
    const target = byKey.get(String(active.id))
    const onto = over && byKey.get(String(over.id))
    if (target && onto) workspaceTabs.moveTab(target, onto)
  }

  return (
    <nav
      aria-label="Workspace sections"
      className="flex min-w-0 items-center gap-2"
    >
      <div className="flex min-w-0 items-center gap-x-4 overflow-x-auto [scrollbar-width:thin]">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: tabAnnouncements(
              (id) => labels.get(String(id)) ?? "",
            ),
          }}
        >
          <SortableContext
            items={closable.map(tabKey)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab, index) => (
              <StripTab
                key={views[index].key}
                tab={tab}
                view={views[index]}
                onClose={() => workspaceTabs.closeTab(tab)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Open a tab"
            data-testid="workspace-tab-add"
            className="shrink-0 rounded p-1 opacity-60 transition-opacity hover:bg-app-ink/10 hover:opacity-100"
          >
            <Plus size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {CLOSABLE_TABS.map((meta) => {
            const Icon = tabIcon(meta)
            return (
              <DropdownMenuItem
                key={meta.id}
                onSelect={() => workspaceTabs.openTab(meta.id)}
              >
                <Icon size={14} /> {meta.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}

/**
 * One tab. A Closable tab is a sortable, shrinkable container: it gives up
 * its label first, down to icon width, and once it is that narrow its ×
 * (when shown at all) sits over the icon instead of beside it.
 */
function StripTab({
  tab,
  view,
  onClose,
}: {
  tab: Tab
  view: ReturnType<typeof tabPresentation>
  onClose: () => void
}) {
  const Icon = tabIcon(view.meta)
  const sortable = useSortable({ id: view.key, disabled: !view.closable })
  // Only the drag instructions. The rest would make the link a button
  // (`role`, `aria-pressed`) or rename it ("sortable").
  const describedBy = sortable.attributes["aria-describedby"]
  const x = sortable.transform?.x ?? 0
  // A press anywhere on the tab drags it, × included, so a touch hold works
  // on a shrunk active tab whose × covers its icon. The keys stay on the link:
  // Space on a focused × must press it, not pick its tab up.
  const { onKeyDown, ...pointer } = sortable.listeners ?? {}

  return (
    <span
      ref={sortable.setNodeRef}
      style={{
        // Horizontal only: the strip is one row.
        transform: `translate3d(${x}px, 0, 0)`,
        transition: sortable.transition,
      }}
      className={`group relative flex min-w-0 items-center gap-1 ${view.itemClass}`}
      {...pointer}
    >
      <Link
        ref={sortable.setActivatorNodeRef}
        onKeyDown={onKeyDown as KeyboardEventHandler | undefined}
        aria-describedby={view.closable ? describedBy : undefined}
        draggable={false}
        id={view.anchorId}
        to="/workspace"
        search={(prev) => tabSearch(prev, tab)}
        replace
        title={view.label}
        aria-current={view.ariaCurrent}
        // Middle-click closes a Closable tab, as in a browser. On a Fixed
        // tab it still opens a new one.
        onAuxClick={(event) => {
          if (event.button !== 1 || !view.closable) return
          event.preventDefault()
          onClose()
        }}
        className={`text-xs font-mono flex min-w-0 flex-1 select-none items-center gap-2 pb-1 border-b-2 transition-all [-webkit-touch-callout:none] ${view.linkClass}`}
      >
        <Icon size={14} className="shrink-0" />
        <span className="min-w-0 truncate @max-[4.5rem]:hidden">
          {view.label}
        </span>
      </Link>
      {view.closable && (
        <button
          type="button"
          aria-label={`Close ${view.label}`}
          data-testid="workspace-tab-close"
          onClick={onClose}
          className={`shrink-0 rounded p-0.5 transition-opacity hover:bg-app-ink/10 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 @max-[4.5rem]:absolute @max-[4.5rem]:left-0 @max-[4.5rem]:top-0 @max-[4.5rem]:bg-app-muted ${view.closeClass}`}
        >
          <X size={12} />
        </button>
      )}
    </span>
  )
}
