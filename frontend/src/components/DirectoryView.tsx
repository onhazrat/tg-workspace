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
  type DirectoryFilter,
  directoryFilterBody,
  type Measure,
} from "@/lib/directory/directory-filter"
import { mineWindow } from "@/lib/directory/directory-panel"
import {
  chooseSort,
  type DirectoryViewRequest,
  headerSort,
  listSummary,
  sortValue,
} from "@/lib/directory/directory-view"
import { mapGroups } from "@/lib/filter-tree"

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
  measure,
  ...rest
}: {
  request: DirectoryViewRequest
  filter: DirectoryFilter
  measure: Measure
  initial?: MetricBound
  onSubmit: Parameters<MeasureEditorRender>[0]["onSubmit"]
  onBack: () => void
}) {
  const others = {
    ...request,
    filter: directoryFilterBody(withoutMeasure(filter, measure.key)),
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
  const usePreviewCount = (bound: MetricBound | null) => {
    const candidate = useDebouncedValue(JSON.stringify(bound), 250)
    const preview = useQuery({
      queryKey: queryKeys.directoryRead("count", { others, candidate }),
      queryFn: () =>
        dataCountDirectory({
          body: {
            ...others,
            candidate: {
              kind: "atom",
              cond: {
                type: "measure",
                measure: measure.key,
                ...JSON.parse(candidate),
              },
            },
          },
        }),
      enabled: candidate !== "null",
    })
    return bound ? preview.data?.total : undefined
  }
  return (
    <DirectoryBoundEditor
      measure={measure}
      distribution={distribution.data}
      usePreviewCount={usePreviewCount}
      onSubmit={(bound) =>
        rest.onSubmit({ type: "measure", measure: measure.key, ...bound })
      }
      initial={rest.initial}
      onBack={rest.onBack}
    />
  )
}

/**
 * The detail panel's three reads (DIR-03): the entry by handle, so a panel off
 * the current page still opens, its stored Posts, and "Why it's here" under
 * the view's "your channels", Reference kinds and Cited-by window.
 */
function DirectoryPanelReads({
  handle,
  request,
  windowDays,
  following,
  onFollow,
  onClose,
}: {
  handle: string
  request: DirectoryViewRequest
  windowDays: number | null
  following: boolean
  onFollow: () => void
  onClose: () => void
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
  }
  const why = useQuery({
    queryKey: queryKeys.directoryRead("why", whyBody),
    queryFn: () => dataGetDirectoryWhy({ body: whyBody }),
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
      onClose={onClose}
    />
  )
}

export function DirectoryView() {
  const d = useDirectory()
  const { view, patch, list } = d
  const shown = listSummary(list.data, list.isFetching, d.yours.source)
  const vocabulary = directoryVocabulary(shown.languages, (props) => (
    <MeasureEditor request={d.request} filter={d.filter} {...props} />
  ))
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
        onSort={(key) => patch(headerSort(view, key, d.yours.source))}
        onPage={(page) => patch({ page })}
        onOpen={d.setOpen}
      />
      {d.open && (
        <DirectoryPanelReads
          handle={d.open}
          request={d.request}
          windowDays={mineWindow(d.filter)}
          following={d.following.has(d.open)}
          onFollow={() => d.open && void d.follow([d.open])}
          onClose={() => d.setOpen(null)}
        />
      )}
    </div>
  )
}
