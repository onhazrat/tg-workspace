/**
 * The Directory tab (DIR-02): the bar, the bulk bar and the table, wired to
 * `useDirectory`. Every piece is a props-only component under
 * `components/directory/`; this file only connects them to the server.
 */
import { useQuery } from "@tanstack/react-query"

import {
  dataCountDirectory,
  dataGetDirectoryDistribution,
  dataGetDirectoryEntry,
  dataGetDirectoryNeighbours,
  dataGetDirectoryPosts,
  dataGetDirectoryWhy,
} from "@/client"
import { DirectoryBar } from "@/components/directory/DirectoryBar"
import { DirectoryBoundEditor } from "@/components/directory/DirectoryBoundEditor"
import { DirectoryBulkBar } from "@/components/directory/DirectoryBulkBar"
import { DirectoryPanel } from "@/components/directory/DirectoryPanel"
import { DirectoryTable } from "@/components/directory/DirectoryTable"
import {
  directoryVocabulary,
  type MeasureEditorRender,
} from "@/components/directory/directory-vocabulary"
import { queryKeys } from "@/hooks/queryKeys"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useDirectory } from "@/hooks/useDirectory"
import { errorText } from "@/lib/artifacts/artifact-run"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import {
  type DirectoryCond,
  type DirectoryFilter,
  directoryFilterBody,
  firstShared,
  type Measure,
  type MeasureKey,
  type PickSets,
  resolvePicks,
} from "@/lib/directory/directory-filter"
import { mineWindow } from "@/lib/directory/directory-panel"
import {
  chooseSort,
  type DirectoryViewRequest,
  headerSort,
  listSummary,
  sortValue,
} from "@/lib/directory/directory-view"
import { appendAnd, mapGroups } from "@/lib/filter-tree"

/** The filter without `measure`'s bounds: what its spread is drawn under. */
const withoutMeasure = (filter: DirectoryFilter, measure: string) =>
  mapGroups(filter, (group) => ({
    ...group,
    children: group.children.filter(
      (c) =>
        c.kind === "group" ||
        c.cond.type !== "measure" ||
        c.cond.measure !== measure,
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
  sets: PickSets
  measure: Measure
  initial?: MetricBound
  onSubmit: Parameters<MeasureEditorRender>[0]["onSubmit"]
  onBack: () => void
}) {
  const others = {
    ...request,
    filter: directoryFilterBody(withoutMeasure(filter, measure.key), sets),
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
  const candidate = useDebouncedValue(JSON.stringify(bound), 250)
  const count = useQuery({
    queryKey: queryKeys.directoryRead("count", { others, candidate }),
    queryFn: () =>
      dataCountDirectory({
        body: {
          ...others,
          candidate: {
            kind: "atom",
            cond: { type: "measure", measure, ...JSON.parse(candidate) },
          },
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
}: {
  handle: string
  request: DirectoryViewRequest
  /** Each Shared relation's picks while it is on, for Why (DIR-07). */
  shared: { parents: string[] | null; children: string[] | null }
  windowDays: number | null
  following: boolean
  onFollow: () => void
  onDismiss: (dismissed: boolean) => void
  onClose: () => void
  onFilter: (cond: DirectoryCond) => void
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
    />
  )
}

export function DirectoryView() {
  const d = useDirectory()
  const { view, patch, list } = d
  const shown = listSummary(list.data, list.isFetching, d.yours.source)
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
  )
  const picksOf = (relation: "parents" | "children") => {
    const cond = firstShared(d.filter, relation)
    return cond ? resolvePicks(cond, d.sets) : null
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
        hidden={d.hidden}
        onHidden={d.setHidden}
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
        onClearAll={d.clearAll}
      />
      {list.error && (
        <p className="mb-2 text-xs text-red-500">
          {errorText(list.error, "The Directory did not load.")}
        </p>
      )}
      <DirectoryBulkBar
        ticks={d.ticks}
        busy={[...d.ticks].some((h) => d.following.has(h))}
        onFollow={(handles) => void d.follow(handles)}
        onDismiss={(handles) => void d.dismiss(handles)}
        onClear={() => d.setTicks([])}
      />
      <DirectoryTable
        rows={shown.rows}
        total={shown.total ?? 0}
        page={view.page}
        sort={view.sort}
        descending={view.descending}
        hidden={d.hidden}
        ticks={d.ticks}
        onTicks={d.setTicks}
        following={d.following}
        onFollow={(handle) => void d.follow([handle])}
        onDismiss={(handle, dismissed) => void d.dismiss([handle], dismissed)}
        onSort={(key) => patch(headerSort(view, key, d.yours.source))}
        onPage={(page) => patch({ page })}
        onOpen={d.setOpen}
      />
      {d.open && (
        <DirectoryPanelReads
          handle={d.open}
          request={d.request}
          shared={{
            parents: picksOf("parents"),
            children: picksOf("children"),
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
        />
      )}
    </div>
  )
}
