import React from "react"
import { formatDateToLocalISO } from "@/lib/utils"

const isList = (node: unknown) =>
  React.isValidElement(node) && (node.type === "ul" || node.type === "ol")

/**
 * The text a markdown node shows, minus any nested list, so clicking a parent
 * bullet searches for that bullet and not for everything under it.
 */
export function extractText(children: React.ReactNode): string {
  if (typeof children === "string") return children
  if (typeof children === "number") return children.toString()
  if (Array.isArray(children)) return children.map(extractText).join("")
  if (!React.isValidElement(children) || isList(children)) return ""
  const inner = (children.props as { children?: React.ReactNode }).children
  if (children.type === "li" && React.Children.toArray(inner).some(isList))
    return ""
  return extractText(inner)
}

/** The semantic-search query for a clicked bullet: its text without `[channel #id]` citations, or null when blank. */
export function relatedPostsQuery(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return text.replace(/\[([^\]]+?)\s*#(\d+)\]/g, "").trim() || trimmed
}

export function exportFilename(now: Date): string {
  return `analysis-${formatDateToLocalISO(now).split("T")[0]}.md`
}
