/**
 * Plain-text projection of markdown, for previews.
 *
 * Summary bodies are markdown and are rendered as such in the Summary tab. A list
 * row is not the place to render markdown — but it is also not the place to show
 * the raw source, which is what a bare `substring` does: every History preview
 * used to open with a literal `**🔴 Executive Summary**`.
 *
 * This strips the syntax and keeps the words. It is deliberately regex-based and
 * lossy: it never has to round-trip, only to read well in two clipped lines.
 */

/** Markdown syntax removal, applied in order — images before links, since `![a](b)` contains `[a](b)`. */
const STRIP_RULES: [RegExp, string][] = [
  // Fenced code blocks: drop the fence and any language tag, keep the code text.
  [/^```[^\n]*$/gm, ""],
  // ATX headings: `## Title` -> `Title`.
  [/^\s{0,3}#{1,6}\s+/gm, ""],
  // Blockquote markers.
  [/^\s{0,3}>\s?/gm, ""],
  // Horizontal rules, before emphasis so `***` is not read as bold.
  [/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, ""],
  // Unordered and ordered list markers.
  [/^\s*[-*+]\s+/gm, ""],
  [/^\s*\d+[.)]\s+/gm, ""],
  // Images -> alt text; links -> label.
  [/!\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/\[([^\]]*)\]\([^)]*\)/g, "$1"],
  // Bold/italic/strikethrough. Asterisk forms first; the `_` forms are anchored to
  // non-word boundaries so snake_case identifiers survive intact.
  [/(\*\*\*)(.+?)\1/g, "$2"],
  [/(\*\*)(.+?)\1/g, "$2"],
  [/(\*)(.+?)\1/g, "$2"],
  [/~~(.+?)~~/g, "$1"],
  [/(^|\W)__(.+?)__(?=\W|$)/g, "$1$2"],
  [/(^|\W)_(.+?)_(?=\W|$)/g, "$1$2"],
  // Inline code.
  [/`([^`]*)`/g, "$1"],
  // Leftover HTML tags.
  [/<[^>]+>/g, ""],
]

/** Markdown source -> readable single-run plain text. */
export function stripMarkdown(markdown: string): string {
  let text = markdown
  for (const [pattern, replacement] of STRIP_RULES) {
    text = text.replace(pattern, replacement)
  }
  // Collapse the whitespace the stripping leaves behind: a preview is clipped to
  // two lines by CSS, so blank lines would waste one of them.
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Preview text for a markdown body: syntax stripped, clipped on a word boundary,
 * with a real ellipsis. Returns the whole string, unsuffixed, when it already fits.
 */
export function markdownPreview(markdown: string, maxChars = 200): string {
  const text = stripMarkdown(markdown)
  if (text.length <= maxChars) return text

  const clipped = text.slice(0, maxChars)
  const lastSpace = clipped.lastIndexOf(" ")
  // Fall back to the hard cut for scripts that do not space-separate words.
  const body = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped
  return `${body.trimEnd()}…`
}
