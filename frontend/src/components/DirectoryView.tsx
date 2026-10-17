/**
 * The Directory tab (DIR-02): the bar, the bulk bar and the table, wired to
 * `useDirectory`. Every piece is a props-only component under
 * `components/directory/`; this file only connects them to the server.
 */
import { useQuery } from "@tanstack/react-query"
import { Keyboard } from "lucide-react"
import {
  type DirectoryWhyRequest,
  dataCountDirectory,
  dataGetDirectoryDistribution,
  dataGetDirectoryEntry,
  dataGetDirectoryNeighbours,
  dataGetDirectoryPosts,
  dataGetDirectoryWhy,
} from "@/client"
import { DirectoryBar } from "@/components/directory/DirectoryBar"
import type { BoostMode } from "@/components/directory/DirectoryBoost"
import { DirectoryBoundEditor } from "@/components/directory/DirectoryBoundEditor"
import { DirectoryBulkBar } from "@/components/directory/DirectoryBulkBar"
import {
  DirectoryKeyHelp,
  useDirectoryKeyboard,
} from "@/components/directory/DirectoryKeyboard"
import { DirectoryPanel } from "@/components/directory/DirectoryPanel"
import {
  DirectoryTable,
  PAGE_SIZE,
} from "@/components/directory/DirectoryTable"
import { TagsMenu } from "@/components/directory/DirectoryTags"
import { DirectoryTimeEditor } from "@/components/directory/DirectoryTimeEditor"
import {
  directoryVocabulary,
  type MeasureEditorRender,
  type MomentEditorRender,
} from "@/components/directory/directory-vocabulary"
import { queryKeys } from "@/hooks/queryKeys"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useDirectory } from "@/hooks/useDirectory"
import { useIsMobile } from "@/hooks/useMobile"
import { useSessionFlag } from "@/hooks/useSessionFlag"
import { useDirectoryTags } from "@/hooks/useTags"
import { errorText } from "@/lib/artifacts/artifact-run"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import { seesInternals } from "@/lib/directory/directory-columns"
import {
  type DirectoryCond,
  type DirectoryFilter,
  type DirectoryTimeCond,
  directoryFilterBody,
  firstShared,
  type Measure,
  type MeasureKey,
  type Moment,
  type SeedSets,
  seedForms,
} from "@/lib/directory/directory-filter"
import { mineWindow } from "@/lib/directory/directory-panel"
import type { Tagging } from "@/lib/directory/directory-tags"
import {
  chooseSort,
  type DirectoryViewRequest,
  headerSort,
  listSummary,
  sortValue,
} from "@/lib/directory/directory-view"
import { appendAnd, mapGroups } from "@/lib/filter-tree"
import { pillClass } from "./PostFilterParts"

/** The filter without its bounds on `measure`, a measure or a moment, which
 * is what that one's spread is drawn under. */
const withoutBoundsOn = (filter: DirectoryFilter, measure: string) =>
  mapGroups(filter, (group) => ({
    ...group,
    children: group.children.filter(
      (c) =>
        c.kind === "group" ||
        !(
          (c.cond.type === "measure" && c.cond.measure === measure) ||
          (c.cond.type === "time" && c.cond.moment === measure)
        ),
    ),
  }))

/**
 * A bound's editor, reading the measure's spread under every other Condition
 * and previewing how many a candidate leaves. ponytail: inside an OR the
 * preview ANDs the candidate on, so it is approximate there; exact needs the
 * Condition's place in the tree.
 */
function MeasureEditor({
  request,
  filter,
  sets,
  measure,
  ...rest
}: {
  request: DirectoryViewRequest
  filter: DirectoryFilter
  sets: SeedSets
  measure: Measure
  initial?: MetricBound
  onSubmit: Parameters<MeasureEditorRender>[0]["onSubmit"]
  onBack: () => void
}) {
  const others = {
    ...request,
    filter: directoryFilterBody(withoutBoundsOn(filter, measure.key), sets),
  }
  const distribution = useQuery({
    queryKey: queryKeys.directoryRead("distribution", {
      others,
      measure: measure.key,
    }),
    queryFn: () =>
      dataGetDirectoryDistribution({
        body: { ...others, measure: measure.key },
      }),
  })
  return (
    <DirectoryBoundEditor
      measure={measure}
      distribution={distribution.data}
      countFor={(bound) => (
        <BoundCount others={others} measure={measure.key} bound={bound} />
      )}
      onSubmit={(bound) =>
        rest.onSubmit({ type: "measure", measure: measure.key, ...bound })
      }
      initial={rest.initial}
      onBack={rest.onBack}
    />
  )
}

/**
 * A Time bound's editor (DPF): the moment's spread under every other
 * Condition, in epoch ms, and how many a candidate leaves, as for a measure.
 */
function MomentEditor({
  request,
  filter,
  sets,
  moment,
  ...rest
}: {
  request: DirectoryViewRequest
  filter: DirectoryFilter
  sets: SeedSets
  moment: Moment
  initial?: DirectoryTimeCond
  onSubmit: Parameters<MomentEditorRender>[0]["onSubmit"]
  onBack: () => void
}) {
  const others = {
    ...request,
    filter: directoryFilterBody(withoutBoundsOn(filter, moment.key), sets),
  }
  const distribution = useQuery({
    queryKey: queryKeys.directoryRead("distribution", {
      others,
      measure: moment.key,
    }),
    queryFn: () =>
      dataGetDirectoryDistribution({
        body: { ...others, measure: moment.key },
      }),
  })
  return (
    <DirectoryTimeEditor
      moment={moment}
      distribution={distribution.data}
      countFor={(cond) => <CandidateCount others={others} cond={cond} />}
      onSubmit={rest.onSubmit}
      initial={rest.initial}
      onBack={rest.onBack}
    />
  )
}

/** How many Channels a candidate bound leaves, read a beat after typing stops. */
function BoundCount({
  others,
  measure,
  bound,
}: {
  others: DirectoryViewRequest
  measure: MeasureKey
  bound: MetricBound
}) {
  return (
    <CandidateCount
      others={others}
      cond={{ type: "measure", measure, ...bound }}
    />
  )
}

/** How many Channels a candidate Condition leaves, read a beat after typing stops. */
function CandidateCount({
  others,
  cond,
}: {
  others: DirectoryViewRequest
  cond: DirectoryCond
}) {
  const candidate = useDebouncedValue(JSON.stringify(cond), 250)
  const count = useQuery({
    queryKey: queryKeys.directoryRead("count", { others, candidate }),
    queryFn: () =>
      dataCountDirectory({
        body: {
          ...others,
          candidate: { kind: "atom", cond: JSON.parse(candidate) },
        },
      }),
  })
  const total = count.data?.total
  return total === undefined ? null : ` · ${total.toLocaleString()} channels`
}

/**
 * The detail panel's reads (DIR-03): the entry by handle, so a panel off
 * the current page still opens, its stored Posts, and "Why it's here" under
 * the view's "your channels", Reference kinds and Cited-by window.
 */
function DirectoryPanelReads({
  handle,
  request,
  shared,
  windowDays,
  following,
  onFollow,
  onDismiss,
  onClose,
  onFilter,
  tagging,
  onBoost,
}: {
  handle: string
  request: DirectoryViewRequest
  /** Each Shared relation's Seeds while it is on, for Why (DIR-07). */
  shared: Pick<DirectoryWhyRequest, "parents" | "children">
  windowDays: number | null
  following: boolean
  onFollow: () => void
  onDismiss: (dismissed: boolean) => void
  onClose: () => void
  onFilter: (cond: DirectoryCond) => void
  tagging: Tagging
  onBoost?: (mode: BoostMode, value: number) => void
}) {
  const path = { handle }
  const entry = useQuery({
    queryKey: queryKeys.directoryRead("entry", handle),
    queryFn: () => dataGetDirectoryEntry({ path }),
    retry: false,
  })
  const posts = useQuery({
    queryKey: queryKeys.directoryPosts(handle),
    queryFn: () => dataGetDirectoryPosts({ path }),
    retry: false,
  })
  const whyBody = {
    handle,
    yours: request.yours,
    referenceKinds: request.referenceKinds,
    days: windowDays,
    ...shared,
  }
  const why = useQuery({
    queryKey: queryKeys.directoryRead("why", whyBody),
    queryFn: () => dataGetDirectoryWhy({ body: whyBody }),
  })
  const neighbours = useQuery({
    queryKey: queryKeys.directoryRead("neighbours", handle),
    queryFn: () => dataGetDirectoryNeighbours({ path }),
  })
  return (
    <DirectoryPanel
      handle={handle}
      entry={entry.isError ? null : entry.data}
      posts={posts.isError ? [] : posts.data}
      why={why.data}
      windowDays={windowDays}
      following={following}
      onFollow={onFollow}
      onDismiss={onDismiss}
      onClose={onClose}
      neighbours={neighbours.data}
      onFilter={onFilter}
      tagging={tagging}
      onBoost={onBoost}
    />
  )
}

export function DirectoryView() {
  const d = useDirectory()
  const { view, patch, list } = d
  const shown = listSummary(list.data, list.isFetching, d.yours.source)
  const { tags, tagging, choices } = useDirectoryTags()
  const internals = seesInternals(d.columnsMenu.catalogue)
  const vocabulary = directoryVocabulary(
    shown.languages,
    (props) => (
      <MeasureEditor
        request={d.request}
        filter={d.filter}
        sets={d.sets}
        {...props}
      />
    ),
    d.sets,
    choices,
    (props) => (
      <MomentEditor
        request={d.request}
        filter={d.filter}
        sets={d.sets}
        {...props}
      />
    ),
    internals,
  )
  const total = shown.total ?? 0
  // Below md (DFP-02): the controls in a sheet, the rows as cards.
  const phone = useIsMobile()
  const [keyboardFlag, setKeyboard] = useSessionFlag("directory_keyboard")
  // A phone has no Keyboard switch, so a flag left on at a desk stays off here.
  const keyboard = keyboardFlag && !phone
  const ring = useDirectoryKeyboard({
    on: keyboard,
    handles: shown.rows.map((r) => r.handle),
    open: d.open,
    onOpen: d.setOpen,
    page: view.page,
    lastPage: Math.max(0, Math.ceil(total / PAGE_SIZE) - 1),
    onPage: (page) => patch({ page }),
  })
  /** A Shared relation's Seeds while it is on, as Why takes them (DFP-05). */
  const seedsOf = (relation: "parents" | "children") => {
    const cond = firstShared(d.filter, relation)
    if (!cond) return null
    const seeds = seedForms(cond.seeds).wire(d.sets)
    return "tag" in seeds ? seeds : seeds.handles
  }
  return (
    <div className="pt-4" data-testid="directory-view">
      <DirectoryBar
        filter={d.filter}
        onFilter={d.setFilter}
        vocabulary={vocabulary}
        languages={shown.languages}
        kinds={view.kinds}
        onKinds={(kinds) => patch({ kinds })}
        sortValue={sortValue(view, d.yours.source)}
        onSort={(value) => patch(chooseSort(value))}
        descending={view.descending}
        onToggleDirection={() => patch({ descending: !view.descending })}
        columns={d.columnsMenu}
        total={shown.total}
        size={d.size}
        ms={shown.ms}
        emptyYours={shown.emptyYours}
        search={d.draft}
        onSearch={d.setSearch}
        fields={view.fields}
        onFields={(fields) => patch({ fields })}
        matches={view.matches}
        onMatches={(matches) => patch({ matches })}
        selectedFirst={d.selectedFirst}
        onSelectedFirst={d.setSelectedFirst}
        onClearAll={d.clearAll}
        phone={phone}
      />
      {list.error && (
        <p className="mb-2 text-xs text-red-500">
          {errorText(list.error, "The Directory did not load.")}
        </p>
      )}
      <div className="mb-2 flex justify-end gap-2">
        <TagsMenu
          tags={tags.tags}
          onTick={(name) => void tags.tickTag(name, d.setTicks)}
          onRename={(name, to) => void tags.rename(name, to)}
          onDelete={(name) => void tags.remove(name)}
        />
        <button
          type="button"
          aria-pressed={keyboard}
          onClick={() => setKeyboard(!keyboard)}
          className={`${pillClass(keyboard)} max-md:hidden`}
          title="j / k to move, gg / G to jump, ] / [ to turn the page, an action's letter to fire it"
        >
          <Keyboard size={12} /> Keyboard
        </button>
      </div>
      <DirectoryBulkBar
        ticks={d.ticks}
        busy={[...d.ticks].some((h) => d.following.has(h))}
        followed={
          new Set(
            [
              ...d.sets.follows,
              ...shown.rows.filter((r) => r.followed).map((r) => r.handle),
            ].map((h) => h.toLowerCase()),
          )
        }
        onFollow={(handles) => void d.follow(handles)}
        onDismiss={(handles) => void d.dismiss(handles)}
        onClear={() => d.setTicks([])}
        tagging={tagging}
        boostable={internals}
        onBoost={(handles, mode, value) => void d.boost(handles, mode, value)}
      />
      <DirectoryTable
        rows={shown.rows}
        total={total}
        page={view.page}
        sort={view.sort}
        descending={view.descending}
        shown={d.shownColumns}
        ticks={d.ticks}
        onTicks={d.setTicks}
        following={d.following}
        onFollow={(handle) => void d.follow([handle])}
        onDismiss={(handle, dismissed) => void d.dismiss([handle], dismissed)}
        onSort={(key) => patch(headerSort(view, key, d.yours.source))}
        onPage={(page) => patch({ page })}
        onOpen={d.setOpen}
        ring={ring}
        cards={phone}
        tagging={tagging}
      />
      {d.open && (
        <DirectoryPanelReads
          handle={d.open}
          request={d.request}
          shared={{
            parents: seedsOf("parents"),
            children: seedsOf("children"),
          }}
          windowDays={mineWindow(d.filter)}
          following={d.following.has(d.open)}
          onFollow={() => d.open && void d.follow([d.open])}
          onDismiss={(dismissed) =>
            d.open && void d.dismiss([d.open], dismissed)
          }
          onClose={() => d.setOpen(null)}
          onFilter={(cond) => {
            // As the prototype did: close, so the narrowed list shows.
            d.setFilter(appendAnd(d.filter, cond))
            d.setOpen(null)
          }}
          tagging={tagging}
          // The entry carries a boost only for a DATA_ADMIN reader, which is
          // when the panel shows the control.
          onBoost={(mode, value) =>
            d.open && void d.boost([d.open], mode, value)
          }
        />
      )}
      <DirectoryKeyHelp on={keyboard} />
    </div>
  )
}
