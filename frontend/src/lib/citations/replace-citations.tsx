import React from "react"
import { CitationHover } from "@/components/CitationHover"
import type { Post } from "@/types"

const CITATION_PATTERN = /\[([^\]]+?)\s*#(\d+)\]/g

export type CitationPostResolver = (
  channelName: string,
  postId: number,
) => Post | undefined

/** Draws one `[channel #id]`; `key` is unique within its text node. */
export type CitationRenderer = (
  channelName: string,
  postId: number,
  key: string,
) => React.ReactNode

/** Replace every `[channel #id]` in rendered Markdown with `render`'s node. */
export function splitCitations(
  nodes: React.ReactNode,
  render: CitationRenderer,
): React.ReactNode {
  return React.Children.map(nodes, (child) => {
    if (typeof child === "string") {
      const parts: React.ReactNode[] = []
      let lastIndex = 0
      const regex = new RegExp(CITATION_PATTERN.source, CITATION_PATTERN.flags)
      let match: RegExpExecArray | null
      while ((match = regex.exec(child)) !== null) {
        if (match.index > lastIndex) {
          parts.push(child.substring(lastIndex, match.index))
        }
        parts.push(
          render(
            match[1].trim(),
            parseInt(match[2], 10),
            `${match.index}-${match[2]}`,
          ),
        )
        lastIndex = match.index + match[0].length
      }
      if (lastIndex < child.length) {
        parts.push(child.substring(lastIndex))
      }
      return parts.length > 0 ? parts : child
    }
    if (React.isValidElement(child)) {
      const element = child as React.ReactElement<{
        children?: React.ReactNode
      }>
      return React.cloneElement(element, {
        ...element.props,
        children: splitCitations(element.props.children, render),
      })
    }
    return child
  })
}

/** The Chat tab's citations: a text hover, unchanged by SUMTAB-04. */
export function replaceCitations(
  nodes: React.ReactNode,
  resolvePost?: CitationPostResolver,
): React.ReactNode {
  return splitCitations(nodes, (channelName, postId, key) => (
    <CitationHover
      key={key}
      channelName={channelName}
      postId={postId}
      postSnapshot={resolvePost?.(channelName, postId)}
    />
  ))
}
