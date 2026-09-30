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
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { usePostFacets } from "../hooks/usePostsView"
import {
  activeFilters,
  type ChipClears,
  capPhrase,
  labelOf,
  languageLabel,
  languageSummary,
  mediaSummary,
  POST_ORDER_OPTIONS,
  POST_TYPE_OPTIONS,
} from "../lib/posts/post-filter-bar"
import { MEDIA_KIND_OPTIONS, type MediaKind } from "../lib/posts/post-media"
import {
  CheckList,
  Options,
  PerChannelForm,
  Pill,
  pillClass,
} from "./PostFilterParts"

interface PostFilterProps {
  postSearch: string
  setPostSearch: (val: string) => void
  /** How many Posts the Scope holds, for the footer. */
  shownCount: number
  /** The existing subtitle's qualifiers: the cap and grouping. */
  subtitle: string
}

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

/**
 * One search box for both kinds of search. Keyword filters as you type;
 * Meaning runs on Enter, and is offered only with semantic features on.
 */
function SearchBox({
  postSearch,
  setPostSearch,
}: {
  postSearch: string
  setPostSearch: (value: string) => void
}) {
  const {
    semanticSearchQuery,
    setSemanticSearchQuery,
    semanticSearchRespectsChannels,
    setSemanticSearchRespectsChannels,
  } = useScraper()
  const { embeddingsEnabled } = useSettings()
  const [mode, setMode] = React.useState<"keyword" | "meaning">(
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
          aria-label={meaning ? "Search by meaning" : "Search posts"}
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
            if (meaning && e.key === "Enter" && draft.trim())
              setSemanticSearchQuery(draft.trim())
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
              // The box means one search at a time, so leaving Meaning ends
              // the meaning search rather than leaving it running unseen.
              if (next === "keyword") setSemanticSearchQuery("")
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

export const PostFilter: React.FC<PostFilterProps> = ({
  postSearch,
  setPostSearch,
  shownCount,
  subtitle,
}) => {
  const s = useScraper()
  const { channels } = useData()
  const { setActiveTab } = useUI()
  const [facetsWanted, setFacetsWanted] = React.useState(0)
  const facets = usePostFacets(facetsWanted > 0)
  const wantFacets = (open: boolean) =>
    setFacetsWanted((n) => Math.max(0, n + (open ? 1 : -1)))

  const mediaCounts = new Map(facets?.media.map((f) => [f.value, f.count]))
  // The Languages present, most frequent first, from the server. On a meaning
  // search nothing is counted, so the Languages of the followed Channels stand
  // in, without numbers. A ticked Language is always listed, so it can be
  // unticked.
  const languageCodes = facets
    ? facets.languages.map((f) => f.value)
    : [
        ...new Set(
          channels
            .map((c) => c.language)
            .filter((code): code is string => !!code),
        ),
      ].sort()
  for (const code of s.languageFilter)
    if (!languageCodes.includes(code)) languageCodes.push(code)
  const languageCounts = new Map(
    facets?.languages.map((f) => [f.value, f.count]),
  )

  const chips = activeFilters({
    keyword: postSearch,
    meaning: s.semanticSearchQuery,
    relatedTo: s.relatedPostSearch,
    forwarded: s.forwardedFilter,
    media: s.mediaFilter,
    languages: s.languageFilter,
    cap: s.maxPostsPerChannel,
    capMode: s.maxPostsPerChannelMode,
    order: s.postSortOrder,
    grouped: s.groupByChannel,
  })
  const clear = (what: ChipClears) => {
    if (what === "keyword") setPostSearch("")
    else if (what === "meaning") s.setSemanticSearchQuery("")
    else if (what === "related") s.setRelatedPostSearch(null)
    else if (what === "forwarded") s.setForwardedFilter("all")
    else if (what === "cap") s.setMaxPostsPerChannel(0)
    else if ("media" in what)
      s.setMediaFilter((m) => m.filter((k) => k !== what.media))
    else s.setLanguageFilter((l) => l.filter((c) => c !== what.language))
  }

  return (
    <section className="mb-6 rounded-xl border border-app-ink/10 bg-app-card shadow-md">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          <div className="flex lg:shrink-0">
            <AnalysisWindowControl
              onReturnToAction={() => setActiveTab("action")}
            />
          </div>
          <div className="lg:flex-1">
            <SearchBox postSearch={postSearch} setPostSearch={setPostSearch} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
          <Pill
            label="Media"
            value={mediaSummary(s.mediaFilter)}
            active={s.mediaFilter.length > 0}
            width="w-56"
            testId="post-filter-pill-media"
            onOpenChange={wantFacets}
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
          <Pill
            label="Language"
            value={languageSummary(s.languageFilter)}
            active={s.languageFilter.length > 0}
            testId="post-filter-pill-language"
            onOpenChange={wantFacets}
          >
            <CheckList
              items={languageCodes.map((code) => ({
                key: code,
                label: languageLabel(code),
                count: facets ? (languageCounts.get(code) ?? 0) : undefined,
                checked: s.languageFilter.includes(code),
              }))}
              anyLabel="Any language"
              emptyLabel="No Language read yet"
              onToggle={(code) => s.setLanguageFilter((l) => toggle(l, code))}
              onAny={() => s.setLanguageFilter([])}
            />
          </Pill>

          <span className="mx-1 h-5 w-px bg-app-ink/10" />

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
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-app-ink/5 bg-app-muted/30 px-4 py-2.5 text-xs">
        <span className="font-semibold">
          {shownCount.toLocaleString()} posts
        </span>
        {subtitle && <span className="text-app-ink/50">{subtitle}</span>}
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-label={`Remove ${chip.label}`}
            onClick={() => clear(chip.clears)}
            className="inline-flex items-center gap-1 rounded-full bg-app-ink/10 px-2 py-0.5 hover:bg-app-ink/20"
          >
            {chip.label} <X size={11} />
          </button>
        ))}
        {chips.length > 1 && (
          <button
            type="button"
            onClick={() => {
              for (const chip of chips) clear(chip.clears)
            }}
            className="ml-auto text-app-ink/60 underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>
    </section>
  )
}
