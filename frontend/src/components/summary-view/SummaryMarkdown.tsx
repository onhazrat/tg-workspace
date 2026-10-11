import React from "react"
import type { Components } from "react-markdown"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { useCitedPosts } from "@/hooks/useCitedPosts"
import { useSummaryDetailQuery } from "@/hooks/useSummaries"
import {
  type CitationRenderer,
  splitCitations,
} from "@/lib/citations/replace-citations"
import { SummaryCitation, useCitationSheet } from "./SummaryCitation"
import { extractText, relatedPostsQuery } from "./summary-text"

/** Draws each Citation as the Cited Post's hover card or bottom sheet (SUMTAB-04). */
function useCitationRenderer(): CitationRenderer {
  const { currentSummaryId } = useUI()
  // citedPosts and the Scope's Post refs are not in the list projection.
  const { data: detail } = useSummaryDetailQuery(currentSummaryId)
  const { resolve, loading } = useCitedPosts(detail)
  const sheet = useCitationSheet()
  const { channels } = useData()
  const { addNewChannel } = useScraper()
  const workspace = React.useMemo(
    () => ({
      channel: (name: string) =>
        channels.find((c) => c.name.toLowerCase() === name.toLowerCase()),
      onAddChannel: addNewChannel,
    }),
    [channels, addNewChannel],
  )
  return React.useCallback<CitationRenderer>(
    (channelName, postId, key) => (
      <SummaryCitation
        key={key}
        cited={resolve(channelName, postId)}
        loading={loading}
        sheet={sheet}
        workspace={workspace}
      />
    ),
    [resolve, loading, sheet, workspace],
  )
}

const CitedParagraph: Components["p"] = ({
  node: _node,
  children,
  ...props
}) => {
  const renderCitation = useCitationRenderer()
  return <p {...props}>{splitCitations(children, renderCitation)}</p>
}

/** A leaf bullet searches for related posts on click; a bullet holding a nested list renders as is. */
const SearchableListItem: Components["li"] = ({ node, children, ...props }) => {
  const { setSemanticSearchQuery } = useScraper()
  const { setActiveTab } = useUI()
  const { embeddingsEnabled } = useSettings()
  const renderCitation = useCitationRenderer()

  const hasNestedList = node?.children?.some(
    (child) =>
      child.type === "element" &&
      (child.tagName === "ul" || child.tagName === "ol"),
  )
  if (hasNestedList) return <li {...props}>{children}</li>

  return (
    <li
      {...props}
      className={
        embeddingsEnabled
          ? "cursor-pointer hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded px-2 py-1 -mx-2"
          : "rounded px-2 py-1 -mx-2"
      }
      onClick={(e) => {
        if (!embeddingsEnabled) return
        e.stopPropagation()
        const query = relatedPostsQuery(extractText(children))
        if (query === null) return
        setSemanticSearchQuery(query)
        setActiveTab("posts")
      }}
      title={embeddingsEnabled ? "Click to find related posts" : undefined}
    >
      {splitCitations(children, renderCitation)}
    </li>
  )
}

export const summaryMarkdownComponents: Components = {
  p: CitedParagraph,
  li: SearchableListItem,
}
