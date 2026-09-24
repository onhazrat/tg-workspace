import React from "react"
import { formatDateToLocalISO } from "@/lib/utils"

export const TELEGRAM_MESSAGE_LIMIT = 4096

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

/** Length of the one Telegram message a publish sends: metadata, a blank line, then the body. */
export function telegramMessageLength(
  body: string | null,
  metadataText: string | null,
): number {
  const bodyLength = body?.length ?? 0
  return metadataText === null
    ? bodyLength
    : bodyLength + metadataText.length + 2
}

export function exportFilename(now: Date): string {
  return `analysis-${formatDateToLocalISO(now).split("T")[0]}.md`
}
