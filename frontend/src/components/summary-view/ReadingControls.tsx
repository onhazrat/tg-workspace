import { ChevronDown } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { SUMMARY_TEXT_SIZES, type SummaryTextSize } from "@/lib/settings/schema"

/** Tailwind Typography sizes for each text size choice. */
export const PROSE_SIZE: Record<SummaryTextSize, string> = {
  S: "prose-sm",
  M: "prose-sm md:prose-base",
  L: "prose-base md:prose-lg",
}

/** The reader's text size, S/M/L; the caller remembers it per Account. */
export function ReadingControls({
  textSize,
  onTextSizeChange,
}: {
  textSize: SummaryTextSize
  onTextSizeChange: (size: SummaryTextSize) => void
}) {
  return (
    <div className="mb-4 flex justify-end">
      <TgSegmentedControl
        aria-label="Text size"
        size="sm"
        value={textSize}
        onChange={onTextSizeChange}
        options={SUMMARY_TEXT_SIZES.map((size) => ({
          value: size,
          label: size,
        }))}
      />
    </div>
  )
}

interface Section {
  /** The heading line as written, or `null` for text before the first one. */
  heading: string | null
  /** The heading's words, for the chevron's spoken name. */
  label: string
  body: string
}

// A Markdown heading, or a line that is one bold phrase, which is how the AI
// heads its sections.
const HEADING = /^ {0,3}#{1,6}\s+\S|^\s*\*\*[^*]+\*\*:?\s*$/

// ponytail: a `#` line inside a fenced code block also starts a section;
// Summaries carry no code, add fence tracking if one ever does.
function splitSections(markdown: string): Section[] {
  const sections: Section[] = []
  let current: Section = { heading: null, label: "", body: "" }
  for (const line of markdown.split("\n")) {
    if (!HEADING.test(line)) {
      current.body += `${line}\n`
      continue
    }
    if (current.heading !== null || current.body.trim()) sections.push(current)
    const label = line
      .replace(/^\s*#+|\*\*/g, "")
      .trim()
      .replace(/:$/, "")
    current = { heading: line, label, body: "" }
  }
  sections.push(current)
  return sections
}

/** The report, one fold chevron per section. Fold state lives only here. */
export function FoldableSections({
  markdown,
  render,
}: {
  markdown: string
  render: (markdown: string) => React.ReactNode
}) {
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set())
  const toggle = (index: number) =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(index)) next.add(index)
      return next
    })
  return splitSections(markdown).map((section, index) => {
    const key = `${index}:${section.heading}`
    if (section.heading === null)
      return <div key={key}>{render(section.body)}</div>
    const isFolded = folded.has(index)
    return (
      <section key={key}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-expanded={!isFolded}
            aria-label={`${isFolded ? "Unfold" : "Fold"} ${section.label}`}
            onClick={() => toggle(index)}
            className="shrink-0 rounded p-0.5 text-app-ink/40 hover:bg-app-ink/5 hover:text-app-ink"
          >
            <ChevronDown
              size={16}
              className={isFolded ? "-rotate-90 rtl:rotate-90" : undefined}
            />
          </button>
          <div className="min-w-0 flex-1 [&>*]:my-[0.5em]">
            {render(section.heading)}
          </div>
        </div>
        {!isFolded && render(section.body)}
      </section>
    )
  })
}
