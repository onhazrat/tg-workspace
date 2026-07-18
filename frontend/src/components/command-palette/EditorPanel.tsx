import { Check } from "lucide-react"
import type { KeyboardEvent, RefObject } from "react"
import {
  PaletteFooterHints,
  PaletteSubViewHeader,
} from "@/components/PaletteKeyboardChrome"
import { TgButton } from "@/components/ui/tg-button"
import { getEditorFooterHint } from "@/lib/commands/palette-messages"
import {
  getEditorInputStep,
  getEditorInputType,
} from "@/lib/commands/palette-view-model"
import type { CommandDef, EditorFieldDef } from "@/lib/commands/types"

interface EditorPanelProps {
  command: CommandDef
  /** Resolved label: chained editor field label wins over the schema field. */
  fieldLabel: string | undefined
  field: EditorFieldDef | undefined
  globalStartTimeMode: "retention" | "relative" | "absolute"
  value: string
  onValueChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent, options: { isTextarea: boolean }) => void
  isApplying: boolean
  onApply: () => void
  onBack: () => void
  inputRef: RefObject<HTMLInputElement | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

/** Editor sub-view: single-field value editor with an Apply action. */
export function EditorPanel({
  command,
  fieldLabel,
  field,
  globalStartTimeMode,
  value,
  onValueChange,
  onKeyDown,
  isApplying,
  onApply,
  onBack,
  inputRef,
  textareaRef,
}: EditorPanelProps) {
  const isTextarea = field?.type === "textarea"

  return (
    <div className="space-y-0">
      <PaletteSubViewHeader label={command.label} onBack={onBack} />
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <label
            htmlFor="command-palette-editor"
            className="text-xs font-mono uppercase tracking-widest text-app-ink/60"
          >
            {fieldLabel}
          </label>
          {isTextarea ? (
            <textarea
              ref={textareaRef}
              id="command-palette-editor"
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              onKeyDown={(event) => onKeyDown(event, { isTextarea: true })}
              disabled={isApplying}
              className="min-h-28 w-full rounded-md border border-app-ink/20 bg-app-bg p-3 text-sm disabled:opacity-50"
            />
          ) : (
            <input
              ref={inputRef}
              id="command-palette-editor"
              type={getEditorInputType(field, globalStartTimeMode)}
              min={field?.min}
              max={field?.max}
              step={getEditorInputStep(field)}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              onKeyDown={(event) => onKeyDown(event, { isTextarea: false })}
              disabled={isApplying}
              className="w-full rounded-md border border-app-ink/20 bg-app-bg p-3 text-sm disabled:opacity-50"
            />
          )}
        </div>
        <TgButton
          type="button"
          variant="primary"
          size="md"
          data-testid="command-palette-editor-apply"
          loading={isApplying}
          loadingLabel="Applying…"
          onClick={onApply}
        >
          <Check size={14} />
          Apply
        </TgButton>
      </div>
      <PaletteFooterHints hints={getEditorFooterHint(isTextarea)} />
    </div>
  )
}
