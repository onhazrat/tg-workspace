/**
 * The Posts filter bar (PFB-02, the A1b prototype on `prototype/post-filter-ui`).
 *
 * One row with the Analysis window small on the left and one search box large
 * on the right; under it one row of pills; under that a footer with the Post
 * count and every active filter as a removable chip. It replaced four stacked
 * panels, two search inputs side by side and two active-search banners.
 *
 * Every pill writes the Scope's filter half through `ScraperContext`, so the
 * feed, the counts, every Action and its frozen Scope all see the same choice.
 */
import { Layers, Search, Sparkles, X } from "lucide-react"
import React from "react"
import { AnalysisWindowControl } from "@/components/AnalysisWindowControl"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import type { PostFacetsResponse } from "../client"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { usePostFacets, useViewEstimate } from "../hooks/usePostsView"
import {
  activeFilters,
  capPhrase,
  clearChip,
  labelOf,
  languageLabel,
  languageOptions,
  languageSummary,
  meaningQueryOnKey,
  mediaSummary,
  POST_ORDER_OPTIONS,
  POST_TYPE_OPTIONS,
  type SearchMode,
  viewsSummary,
} from "../lib/posts/post-filter-bar"
import {
  MEDIA_KIND_OPTIONS,
  type MediaFilterValue,
  type MediaKind,
} from "../lib/posts/post-media"
import type {
  ForwardedFilterValue,
  MaxPostsPerChannelMode,
  PostSortOrder,
  ViewMeasure,
  ViewsFilter,
} from "../lib/posts/post-view"
import type { Post } from "../types"
import {
  CheckList,
  Options,
  PerChannelForm,
  Pill,
  pillClass,
  ViewsForm,
} from "./PostFilterParts"
import type { FilterBarOverride } from "./post-card/PostSelectionPrototype"

/** What the bar reads and writes; `ScraperContext` provides all of it. */
export interface FilterBarControls {
  semanticSearchQuery: string
  setSemanticSearchQuery: (value: string) => void
  semanticSearchRespectsChannels: boolean
  setSemanticSearchRespectsChannels: (value: boolean) => void
  relatedPostSearch: Post | null
  setRelatedPostSearch: (value: Post | null) => void
  forwardedFilter: ForwardedFilterValue
  setForwardedFilter: (value: ForwardedFilterValue) => void
  mediaFilter: MediaFilterValue
  setMediaFilter: React.Dispatch<React.SetStateAction<MediaFilterValue>>
  languageFilter: string[]
  setLanguageFilter: React.Dispatch<React.SetStateAction<string[]>>
  viewMeasure: ViewMeasure
  setViewMeasure: (value: ViewMeasure) => void
  viewsFilter: ViewsFilter | null
  setViewsFilter: (value: ViewsFilter | null) => void
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
  /** How many Posts the Scope holds, for the footer. */
  shownCount: number
  /** The existing subtitle's qualifiers: the cap and grouping. */
  subtitle: string
  /** Posts an Estimated views threshold hid for being too new to judge. */
  tooNewToJudge: number
  /** PROTOTYPE (post-card): controls appended to the pill row. */
  trailing?: React.ReactNode
  /** PROTOTYPE (post-card): A-plus-* swap pills and add a filter row. */
  override?: FilterBarOverride
}

export interface PostFilterBarProps extends PostFilterProps {
  controls: FilterBarControls
  embeddingsEnabled: boolean
  /** The Analysis window control, left of the search box. */
  windowControl: React.ReactNode
  /** Per-choice counts; `undefined` while none are known. */
  facets: PostFacetsResponse | undefined
  /** The followed Channels' Languages, for when no counts are known. */
  channelLanguages: string[]
  /** Called as a counting pill opens and closes, so counts load only then. */
  onCountingPillOpenChange: (open: boolean) => void
  /** The deployment's estimation floor, for the Views pill's copy. */
  estimationFloorHours: number
}

/** The floor's default in `services/reach.py`, until the server's arrives. */
const DEFAULT_ESTIMATION_FLOOR_HOURS = 3

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

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

/** The bar itself, props only, so it renders without providers. */
export const PostFilterBar: React.FC<PostFilterBarProps> = (props) => {
  const { postSearch, setPostSearch, controls: s, facets } = props
  const mediaCounts = new Map(facets?.media.map((f) => [f.value, f.count]))
  const languages = languageOptions(
    facets?.languages,
    props.channelLanguages,
    s.languageFilter,
  )
  const chips = activeFilters({
    keyword: postSearch,
    meaning: s.semanticSearchQuery,
    relatedTo: s.relatedPostSearch,
    forwarded: s.forwardedFilter,
    media: s.mediaFilter,
    languages: s.languageFilter,
    views: s.viewsFilter,
    viewMeasure: s.viewMeasure,
    cap: s.maxPostsPerChannel,
    capMode: s.maxPostsPerChannelMode,
    order: s.postSortOrder,
  })
  const setters = { ...s, setPostSearch }

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
          {props.override?.type !== undefined ? (
            props.override.type
          ) : (
            <Pill
              label="Type"
              value={labelOf(POST_TYPE_OPTIONS, s.forwardedFilter)}
              active={s.forwardedFilter !== "all"}
              width="w-64"
              testId="post-filter-pill-type"
            >
              <Options
                options={POST_TYPE_OPTIONS}
                value={s.forwardedFilter}
                onChange={s.setForwardedFilter}
              />
            </Pill>
          )}
          {props.override?.media !== undefined ? (
            props.override.media
          ) : (
            <Pill
              label="Media"
              value={mediaSummary(s.mediaFilter)}
              active={s.mediaFilter.length > 0}
              width="w-56"
              testId="post-filter-pill-media"
              onOpenChange={props.onCountingPillOpenChange}
            >
              <CheckList
                items={MEDIA_KIND_OPTIONS.map((option) => ({
                  key: option.value,
                  label: option.label,
                  count: mediaCounts.get(option.value),
                  checked: s.mediaFilter.includes(option.value),
                  testId: `post-media-filter-${option.value}`,
                }))}
                anyLabel="Any media"
                onToggle={(key) =>
                  s.setMediaFilter((m) => toggle(m, key as MediaKind))
                }
                onAny={() => s.setMediaFilter([])}
              />
            </Pill>
          )}
          {props.override?.language !== undefined ? (
            props.override.language
          ) : (
            <Pill
              label="Language"
              value={languageSummary(s.languageFilter)}
              active={s.languageFilter.length > 0}
              testId="post-filter-pill-language"
              onOpenChange={props.onCountingPillOpenChange}
            >
              <CheckList
                items={languages.map(({ code, count }) => ({
                  key: code,
                  label: languageLabel(code),
                  count,
                  checked: s.languageFilter.includes(code),
                }))}
                anyLabel="Any language"
                emptyLabel="No Language read yet"
                onToggle={(code) => s.setLanguageFilter((l) => toggle(l, code))}
                onAny={() => s.setLanguageFilter([])}
              />
            </Pill>
          )}

          {props.override?.views !== undefined ? (
            props.override.views
          ) : (
            <Pill
              label="Views"
              value={viewsSummary(s.viewsFilter, s.viewMeasure)}
              active={s.viewsFilter != null}
              width="w-80"
              testId="post-filter-pill-views"
            >
              <ViewsForm
                measure={s.viewMeasure}
                setMeasure={s.setViewMeasure}
                views={s.viewsFilter}
                setViews={s.setViewsFilter}
                floorHours={props.estimationFloorHours}
              />
            </Pill>
          )}

          <span className="mx-1 h-5 w-px bg-app-ink/10" />

          {props.override?.order !== undefined ? (
            props.override.order
          ) : (
            <Pill
              label="Order"
              value={labelOf(POST_ORDER_OPTIONS, s.postSortOrder)}
              active={s.postSortOrder !== "newest"}
              width="w-48"
              testId="post-filter-pill-order"
            >
              <Options
                options={POST_ORDER_OPTIONS}
                value={s.postSortOrder}
                onChange={s.setPostSortOrder}
              />
            </Pill>
          )}
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
        {props.override?.extraRow}
      </div>

      {!props.override?.hideFooter && (
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
          {!props.override?.hideChips &&
            chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                aria-label={`Remove ${chip.label}`}
                onClick={() => clearChip(chip.clears, setters)}
                className="inline-flex items-center gap-1 rounded-full bg-app-ink/10 px-2 py-0.5 hover:bg-app-ink/20"
              >
                {chip.label} <X size={11} />
              </button>
            ))}
          {!props.override?.hideChips && chips.length > 1 && (
            <button
              type="button"
              onClick={() => {
                for (const chip of chips) clearChip(chip.clears, setters)
              }}
              className="ml-auto text-app-ink/60 underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** The bar wired to the workspace's state. */
export const PostFilter: React.FC<PostFilterProps> = (props) => {
  const controls = useScraper()
  const { channels } = useData()
  const { embeddingsEnabled } = useSettings()
  const { setActiveTab } = useUI()
  const [openPillCount, setOpenPillCount] = React.useState(0)
  const facets = usePostFacets(openPillCount > 0)
  const estimate = useViewEstimate()
  const channelLanguages = React.useMemo(
    () => channels.map((c) => c.language).filter((code) => !!code) as string[],
    [channels],
  )
  return (
    <PostFilterBar
      {...props}
      controls={controls}
      embeddingsEnabled={embeddingsEnabled}
      windowControl={
        <AnalysisWindowControl
          onReturnToAction={() => setActiveTab("action")}
        />
      }
      facets={facets}
      channelLanguages={channelLanguages}
      estimationFloorHours={
        estimate?.estimationFloorHours ?? DEFAULT_ESTIMATION_FLOOR_HOURS
      }
      onCountingPillOpenChange={(open) =>
        setOpenPillCount((n) => Math.max(0, n + (open ? 1 : -1)))
      }
    />
  )
}
