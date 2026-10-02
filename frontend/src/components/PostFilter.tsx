/**
 * The Posts filter bar (PFB-02, PTR-03).
 *
 * One row with the Analysis window small on the left and one search box large
 * on the right; under it one row of pills; under that the filter row, and a
 * footer with the Post count.
 *
 * The Type, Media and Language dropdowns and the Filters menu build the Post
 * filter, which the filter row shows and edits as a tree (PTR-03). It decides
 * only what the tab shows: a Summary covers the window whatever it says
 * (ADR-026). The keyword, the order and the cap still write the Scope.
 */
import { Layers, Search, Sparkles, X } from "lucide-react"
import React from "react"
import { AnalysisWindowControl } from "@/components/AnalysisWindowControl"
import { FilterRow } from "@/components/filter-tree/FilterRow"
import { SortPicker } from "@/components/filter-tree/SortPicker"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { funnelledValues } from "@/lib/filter-tree"
import {
  emptyPostFilter,
  POST_TYPE_VALUES,
  type PostFacet,
  type PostFilter as PostFilterTree,
} from "@/lib/posts/post-filter"
import type { PostFacetsResponse } from "../client"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { usePostFacets, useViewEstimate } from "../hooks/usePostsView"
import { spotlitBar } from "../lib/posts/channel-spotlight"
import {
  activeFilters,
  capPhrase,
  clearChip,
  languageLabel,
  languageOptions,
  meaningQueryOnKey,
  POST_SORT_OPTIONS,
  postSortChoice,
  postSortDirection,
  postSortKey,
  type SearchMode,
} from "../lib/posts/post-filter-bar"
import { MEDIA_KIND_OPTIONS } from "../lib/posts/post-media"
import { facetRule } from "../lib/posts/post-selection"
import type {
  MaxPostsPerChannelMode,
  PostSortOrder,
  ViewMeasure,
} from "../lib/posts/post-view"
import type { Post } from "../types"
import {
  PostFacetMenu,
  type PostFacetValue,
  PostFiltersMenu,
  postVocabulary,
} from "./PostFilterControls"
import { PerChannelForm, Pill, pillClass } from "./PostFilterParts"
import { useSpotlight } from "./post-card/ChannelSpotlight"

/** What the bar reads and writes; `ScraperContext` provides all of it. */
export interface FilterBarControls {
  semanticSearchQuery: string
  setSemanticSearchQuery: (value: string) => void
  semanticSearchRespectsChannels: boolean
  setSemanticSearchRespectsChannels: (value: boolean) => void
  relatedPostSearch: Post | null
  setRelatedPostSearch: (value: Post | null) => void
  postFilter: PostFilterTree
  setPostFilter: (next: PostFilterTree) => void
  viewMeasure: ViewMeasure
  setViewMeasure: (value: ViewMeasure) => void
  maxPostsPerChannel: number
  setMaxPostsPerChannel: (value: number) => void
  maxPostsPerChannelMode: MaxPostsPerChannelMode
  setMaxPostsPerChannelMode: (value: MaxPostsPerChannelMode) => void
  postSortOrder: PostSortOrder
  setPostSortOrder: (value: PostSortOrder) => void
  groupByChannel: boolean
  setGroupByChannel: (value: boolean) => void
}

interface PostFilterProps {
  postSearch: string
  setPostSearch: (val: string) => void
  /** How many Posts the filter shows, for the footer and the filter row. */
  shownCount: number
  /** The existing subtitle's qualifiers: the cap and grouping. */
  subtitle: string
  /** Posts an Estimated views bound hid for being too new to judge. */
  tooNewToJudge: number
  /** Switches at the end of the pill row: the feed's Compact grid and Keyboard. */
  trailing?: React.ReactNode
}

export interface PostFilterBarProps extends PostFilterProps {
  controls: FilterBarControls
  embeddingsEnabled: boolean
  /** The Analysis window control, left of the search box. */
  windowControl: React.ReactNode
  /** Per-value counts and the window's total; `undefined` while none are known. */
  facets: PostFacetsResponse | undefined
  /** The followed Channels' Languages, for when no counts are known. */
  channelLanguages: string[]
  /** The selected Channels, which a Channel Condition picks from. */
  channelNames: string[]
  /** A spotlight is on without the Account's filters, so the keyword is not applied. */
  keywordIgnored?: boolean
  /** Called as a dropdown opens and closes, so counts load only then. */
  onCountingPillOpenChange: (open: boolean) => void
  /** The deployment's estimation floor, for the views editor's copy. */
  estimationFloorHours: number
  /** A dropdown row's tick, which records a Selection rule (PTR-06). */
  onFacetTick?: (facet: PostFacet, value: string, select: boolean) => void
}

/** The floor's default in `services/reach.py`, until the server's arrives. */
const DEFAULT_ESTIMATION_FLOOR_HOURS = 3

/**
 * One search box for both kinds of search. Keyword filters as you type;
 * Meaning runs on Enter, and is offered only with semantic features on.
 */
function SearchBox({
  postSearch,
  setPostSearch,
  controls,
  embeddingsEnabled,
}: Pick<
  PostFilterBarProps,
  "postSearch" | "setPostSearch" | "controls" | "embeddingsEnabled"
>) {
  const {
    semanticSearchQuery,
    setSemanticSearchQuery,
    semanticSearchRespectsChannels,
    setSemanticSearchRespectsChannels,
  } = controls
  const [mode, setMode] = React.useState<SearchMode>(
    semanticSearchQuery ? "meaning" : "keyword",
  )
  const [draft, setDraft] = React.useState(semanticSearchQuery)
  React.useEffect(() => {
    setDraft(semanticSearchQuery)
    if (semanticSearchQuery) setMode("meaning")
  }, [semanticSearchQuery])
  const meaning = embeddingsEnabled && mode === "meaning"
  const Icon = meaning ? Sparkles : Search

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex h-full items-center gap-2 rounded-xl border bg-app-muted pl-3 pr-1.5 transition-colors focus-within:border-app-ink/30 ${meaning ? "border-blue-500/30" : "border-app-ink/10"}`}
      >
        <Icon
          size={16}
          className={meaning ? "text-blue-500" : "text-app-ink/50"}
        />
        <input
          type="text"
          aria-label={meaning ? "Meaning search" : "Keyword search"}
          value={meaning ? draft : postSearch}
          placeholder={
            meaning
              ? "Describe what you're looking for, then Enter"
              : "Search posts"
          }
          onChange={(e) =>
            meaning ? setDraft(e.target.value) : setPostSearch(e.target.value)
          }
          onKeyDown={(e) => {
            const query = meaningQueryOnKey(meaning, e.key, draft)
            if (query) setSemanticSearchQuery(query)
          }}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm focus:outline-none"
        />
        {embeddingsEnabled && (
          <TgSegmentedControl
            size="sm"
            aria-label="Search mode"
            value={mode}
            onChange={(next) => {
              setMode(next)
              // The box means one search at a time, so switching ends the
              // other search rather than leaving it filtering unseen.
              if (next === "keyword") setSemanticSearchQuery("")
              else setPostSearch("")
            }}
            options={[
              { value: "keyword", label: "Keyword" },
              { value: "meaning", label: "Meaning" },
            ]}
          />
        )}
      </div>
      {meaning && (
        <label className="flex cursor-pointer items-center gap-2 px-1 text-[11px] text-app-ink/60">
          <input
            type="checkbox"
            checked={!semanticSearchRespectsChannels}
            onChange={(e) =>
              setSemanticSearchRespectsChannels(!e.target.checked)
            }
            className="accent-blue-500"
          />
          Search every channel, not only the selected ones
        </label>
      )}
    </div>
  )
}

/**
 * Post date, Views or Estimated views, and a direction (PTR-04). Choosing a
 * measure sets what the views orders read and nothing else.
 */
function PostSortMenu({
  order,
  measure,
  setOrder,
  setMeasure,
}: {
  order: PostSortOrder
  measure: ViewMeasure
  setOrder: (order: PostSortOrder) => void
  setMeasure: (measure: ViewMeasure) => void
}) {
  const key = postSortKey(order, measure)
  const direction = postSortDirection(order)
  const choose = (next: ReturnType<typeof postSortChoice>) => {
    if (next.measure) setMeasure(next.measure)
    setOrder(next.order)
  }
  return (
    <SortPicker
      options={POST_SORT_OPTIONS}
      value={key}
      onChange={(next) => choose(postSortChoice(next, direction))}
      direction={direction}
      onToggleDirection={() =>
        choose(postSortChoice(key, direction === "asc" ? "desc" : "asc"))
      }
      testId="post-sort"
    />
  )
}

type FacetCount = { value: string; count: number; selected: number }

const countOf = (facets: FacetCount[] | undefined) => {
  const counts = new Map(facets?.map((f) => [f.value, f]))
  return (value: string) => {
    const f = counts.get(value)
    return { count: f?.count, selected: f?.selected }
  }
}

/** The bar itself, props only, so it renders without providers. */
export const PostFilterBar: React.FC<PostFilterBarProps> = (props) => {
  const { postSearch, setPostSearch, controls: s, facets } = props
  const filter = s.postFilter
  const typeCount = countOf(facets?.types)
  const mediaCount = countOf(facets?.media)
  const languageCount = countOf(facets?.languages)
  const languages = languageOptions(
    facets?.languages,
    props.channelLanguages,
    funnelledValues(filter, "language"),
  ).map(({ code }) => ({
    id: code,
    label: languageLabel(code),
    ...languageCount(code),
  }))
  const values: Record<PostFacet, PostFacetValue[]> = {
    type: POST_TYPE_VALUES.map((t) => ({
      id: t.value,
      label: t.label,
      ...typeCount(t.value),
    })),
    media: MEDIA_KIND_OPTIONS.map((m) => ({
      id: m.value,
      label: m.label,
      ...mediaCount(m.value),
    })),
    language: languages,
  }
  // A tick reads the window's counts, so it waits for them.
  const onFacetTick = facets ? props.onFacetTick : undefined
  const vocabulary = postVocabulary(
    {
      languages: languages.map(({ id, label }) => ({ id, label })),
      channels: props.channelNames.map((name) => ({
        id: name,
        label: `@${name}`,
      })),
    },
    props.estimationFloorHours,
  )
  const chips = activeFilters({
    meaning: s.semanticSearchQuery,
    relatedTo: s.relatedPostSearch,
    cap: s.maxPostsPerChannel,
    capMode: s.maxPostsPerChannelMode,
    order: s.postSortOrder,
  })

  return (
    <section className="mb-6 rounded-xl border border-app-ink/10 bg-app-card shadow-md">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          <div className="flex lg:shrink-0">{props.windowControl}</div>
          <div className="lg:flex-1">
            <SearchBox
              postSearch={postSearch}
              setPostSearch={setPostSearch}
              controls={s}
              embeddingsEnabled={props.embeddingsEnabled}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["type", "Type"],
              ["media", "Media"],
              ["language", "Language"],
            ] as const
          ).map(([facet, label]) => (
            <PostFacetMenu
              key={facet}
              facet={facet}
              label={label}
              values={values[facet]}
              filter={filter}
              onChange={s.setPostFilter}
              onOpenChange={props.onCountingPillOpenChange}
              onTick={
                onFacetTick &&
                ((value, select) => onFacetTick(facet, value, select))
              }
            />
          ))}
          <PostFiltersMenu
            filter={filter}
            onChange={s.setPostFilter}
            floorHours={props.estimationFloorHours}
          />

          <span className="mx-1 h-5 w-px bg-app-ink/10" />

          <PostSortMenu
            order={s.postSortOrder}
            measure={s.viewMeasure}
            setOrder={s.setPostSortOrder}
            setMeasure={s.setViewMeasure}
          />
          <Pill
            label="Per channel"
            value={capPhrase(
              s.maxPostsPerChannel,
              s.maxPostsPerChannelMode,
              s.postSortOrder,
            )}
            active={s.maxPostsPerChannel > 0}
            width="w-72"
            testId="post-filter-pill-cap"
          >
            <PerChannelForm
              cap={s.maxPostsPerChannel}
              setCap={s.setMaxPostsPerChannel}
              mode={s.maxPostsPerChannelMode}
              setMode={s.setMaxPostsPerChannelMode}
              order={s.postSortOrder}
            />
          </Pill>
          <button
            type="button"
            aria-pressed={s.groupByChannel}
            onClick={() => s.setGroupByChannel(!s.groupByChannel)}
            className={pillClass(s.groupByChannel)}
          >
            <Layers size={12} /> Grouped by channel
          </button>
          {props.trailing}
        </div>
      </div>

      <FilterRow
        filter={filter}
        onChange={s.setPostFilter}
        vocabulary={vocabulary}
        testId="post-filter"
        search={props.keywordIgnored ? "" : postSearch}
        shownCount={props.shownCount}
        totalCount={facets?.total ?? props.shownCount}
        approximate={
          facets
            ? undefined
            : "The window's total has not loaded, and a meaning search never counts one"
        }
        onClearSearch={() => setPostSearch("")}
        onClearAll={() => {
          setPostSearch("")
          s.setPostFilter(emptyPostFilter())
        }}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-app-ink/5 bg-app-muted/30 px-4 py-2.5 text-xs">
        <span className="font-semibold">
          {props.shownCount.toLocaleString()} posts
        </span>
        {props.subtitle && (
          <span className="text-app-ink/50">{props.subtitle}</span>
        )}
        {props.tooNewToJudge > 0 && (
          <span className="text-app-ink/50">
            {props.tooNewToJudge.toLocaleString()} too new to judge
          </span>
        )}
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-label={`Remove ${chip.label}`}
            onClick={() => clearChip(chip.clears, s)}
            className="inline-flex items-center gap-1 rounded-full bg-app-ink/10 px-2 py-0.5 hover:bg-app-ink/20"
          >
            {chip.label} <X size={11} />
          </button>
        ))}
      </div>
    </section>
  )
}

/** The bar wired to the workspace's state. */
export const PostFilter: React.FC<PostFilterProps> = (props) => {
  const spot = useSpotlight()
  // A spotlight's tree is what the row shows and edits (PTR-04).
  const scraper = useScraper()
  const { controls, keywordIgnored } = spotlitBar(
    scraper,
    spot.spotlight,
    spot.setFilter,
  )
  const { channels, selectedChannels } = useData()
  const { embeddingsEnabled } = useSettings()
  const { setActiveTab } = useUI()
  const [openPillCount, setOpenPillCount] = React.useState(0)
  // The filter row says "N of M", and M is the window's total, so the counts
  // load while it is showing as well as while a dropdown is open.
  const rowShowing =
    controls.postFilter.children.length > 0 || props.postSearch.trim() !== ""
  const facets = usePostFacets(openPillCount > 0 || rowShowing, spot.spotlight)
  const estimate = useViewEstimate()
  const channelLanguages = React.useMemo(
    () => channels.map((c) => c.language).filter((code) => !!code) as string[],
    [channels],
  )
  const channelNames = React.useMemo(
    () => [...selectedChannels].sort(),
    [selectedChannels],
  )
  return (
    <PostFilterBar
      {...props}
      controls={controls}
      keywordIgnored={keywordIgnored}
      embeddingsEnabled={embeddingsEnabled}
      windowControl={
        <AnalysisWindowControl
          onReturnToAction={() => setActiveTab("action")}
        />
      }
      facets={facets}
      channelLanguages={channelLanguages}
      channelNames={channelNames}
      estimationFloorHours={
        estimate?.estimationFloorHours ?? DEFAULT_ESTIMATION_FLOOR_HOURS
      }
      onCountingPillOpenChange={(open) =>
        setOpenPillCount((n) => Math.max(0, n + (open ? 1 : -1)))
      }
      onFacetTick={(facet, value, select) =>
        scraper.appendSelection([
          facetRule(select, facet, value, spot.spotlight?.channel),
        ])
      }
    />
  )
}
