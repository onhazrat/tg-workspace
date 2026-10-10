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
