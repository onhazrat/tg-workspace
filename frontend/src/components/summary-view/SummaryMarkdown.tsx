import React from "react"
import type { Components } from "react-markdown"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { useSummaryDetailQuery } from "@/hooks/useSummaries"
import { replaceCitations } from "@/lib/citations/replace-citations"
import type { Summary } from "@/types"
import { extractText, relatedPostsQuery } from "./summary-text"

const EMPTY_CITED_POSTS: NonNullable<Summary["citedPosts"]> = {}

function useCitedPostResolver() {
  const { currentSummaryId } = useUI()
  // citedPosts is not in the list projection — fetch the row being viewed.
  const { data: detail } = useSummaryDetailQuery(currentSummaryId)
  const citedPosts = detail?.citedPosts ?? EMPTY_CITED_POSTS

  return React.useCallback(
    (channelName: string, postId: number) =>
      citedPosts[`${channelName}-${postId}`],
    [citedPosts],
  )
}

const CitedParagraph: Components["p"] = ({
  node: _node,
  children,
  ...props
}) => {
  const resolvePost = useCitedPostResolver()
  return <p {...props}>{replaceCitations(children, resolvePost)}</p>
}

/** A leaf bullet searches for related posts on click; a bullet holding a nested list renders as is. */
const SearchableListItem: Components["li"] = ({ node, children, ...props }) => {
  const { setSemanticSearchQuery } = useScraper()
  const { setActiveTab } = useUI()
  const { embeddingsEnabled } = useSettings()
  const resolvePost = useCitedPostResolver()

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
      {replaceCitations(children, resolvePost)}
    </li>
  )
}

export const summaryMarkdownComponents: Components = {
  p: CitedParagraph,
  li: SearchableListItem,
}
