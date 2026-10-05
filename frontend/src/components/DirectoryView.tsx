/**
 * The Directory tab (DIR-02): the bar, the bulk bar and the table, wired to
 * `useDirectory`. Every piece is a props-only component under
 * `components/directory/`; this file only connects them to the server.
 */
import { useQuery } from "@tanstack/react-query"

import { dataCountDirectory, dataGetDirectoryDistribution } from "@/client"
import { DirectoryBar } from "@/components/directory/DirectoryBar"
import { DirectoryBoundEditor } from "@/components/directory/DirectoryBoundEditor"
import { DirectoryBulkBar } from "@/components/directory/DirectoryBulkBar"
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
import {
  chooseSort,
  type DirectoryViewRequest,
  headerSort,
  sortValue,
} from "@/lib/directory/directory-view"
import { mapGroups } from "@/lib/filter-tree"
import { languageLabel } from "@/lib/posts/post-filter-bar"

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

export function DirectoryView() {
  const d = useDirectory()
  const { view, patch, list } = d
  const languages = list.data?.languages ?? []
  const vocabulary = directoryVocabulary(
    languages.flatMap(({ language, count }) =>
      language
        ? [
            {
              id: language,
              label: languageLabel(language),
              hint: String(count),
            },
          ]
        : [],
    ),
    (props) => (
      <MeasureEditor request={d.request} filter={d.filter} {...props} />
    ),
  )
  const rows = list.data?.rows ?? []
  return (
    <div className="pt-4" data-testid="directory-view">
      <DirectoryBar
        filter={d.filter}
        onFilter={d.setFilter}
        vocabulary={vocabulary}
        languages={languages}
        kinds={view.kinds}
        onKinds={(kinds) => patch({ kinds })}
        sortValue={sortValue(view, d.yours.source)}
        onSort={(value) => patch(chooseSort(value))}
        descending={view.descending}
        onToggleDirection={() => patch({ descending: !view.descending })}
        hidden={d.hidden}
        onHidden={d.setHidden}
        total={list.data?.total}
        size={d.size}
        ms={list.isFetching ? undefined : list.data?.ms}
        emptyYours={list.data?.yoursSize === 0 ? d.yours.source : undefined}
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
        rows={rows}
        total={list.data?.total ?? 0}
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
      />
    </div>
  )
}
