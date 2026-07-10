import React from "react"
import { CitationHover } from "@/components/CitationHover"
import type { Post } from "@/types"

const CITATION_PATTERN = /\[([^\]]+?)\s*#(\d+)\]/g

export type CitationPostResolver = (
  channelName: string,
  postId: number,
) => Post | undefined

export function replaceCitations(
  nodes: React.ReactNode,
  resolvePost?: CitationPostResolver,
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
        const channelName = match[1].trim()
        const postId = parseInt(match[2], 10)
        parts.push(
          <CitationHover
            key={`${match.index}-${match[2]}`}
            channelName={channelName}
            postId={postId}
            postSnapshot={resolvePost?.(channelName, postId)}
          />,
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
        children: replaceCitations(element.props.children, resolvePost),
      })
    }
    return child
  })
}
