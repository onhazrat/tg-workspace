import React from "react"
import type { Components } from "react-markdown"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import {
  type CitationRenderer,
  splitCitations,
} from "@/lib/citations/replace-citations"
import type { CitedPost } from "@/lib/summaries/cited-posts"
import { type PreviewWorkspace, usePreviewSheet } from "../PostPreview"
import { SummaryCitation } from "./SummaryCitation"
import { extractText, relatedPostsQuery } from "./summary-text"

const CitationRendererContext = React.createContext<CitationRenderer | null>(
  null,
)

/** A Citation as written, where no Summary body provides the hover cards. */
const plainCitation: CitationRenderer = (channelName, postId, key) => (
  <React.Fragment key={key}>{`[${channelName} #${postId}]`}</React.Fragment>
)

/**
 * Draws each Citation as the Cited Post's hover card or bottom sheet
 * (SUMTAB-04). Built once per Summary body and read by every paragraph and
 * bullet, rather than each one running the lookups again.
 */
export function CitationRendererProvider({
  resolve,
  loading,
  workspace,
  children,
}: {
  resolve: (channelName: string, postId: number) => CitedPost
  loading: boolean
  workspace: PreviewWorkspace
  children: React.ReactNode
}) {
  const sheet = usePreviewSheet()
  const render = React.useCallback<CitationRenderer>(
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
  return (
    <CitationRendererContext.Provider value={render}>
      {children}
    </CitationRendererContext.Provider>
  )
}

const useCitationRenderer = () =>
  React.useContext(CitationRendererContext) ?? plainCitation

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
