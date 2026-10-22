/**
 * The header's keyboard mode switch and shortcuts button, and the full list
 * they open (ADR-034). The switch is filled while keyboard mode is on, the
 * shortcuts button while a list shows; it steps the help as `?` does. Both
 * are hidden on a phone, which has no keyboard to use them with.
 */
import { BookKey, Keyboard } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import { ShortcutsDialog } from "@/components/workspace-shell/WorkspaceShellParts"
import { setKeyboardMode } from "@/lib/keyboard/mode"
import { useHelpControls } from "./KeyboardMode"

/** A header icon button, and one filled while what it switches is on. */
export const HEADER_BUTTON_OUTLINED =
  "border-app-ink border-opacity-10 hover:border-opacity-40"
const FILLED = "border-app-ink bg-app-ink text-app-bg"

const look = (filled: boolean) =>
  `p-1.5 border transition-all rounded-md max-md:hidden ${filled ? FILLED : HEADER_BUTTON_OUTLINED}`

export function KeyboardButtons({ commandKey }: { commandKey: string }) {
  const help = useHelpControls()
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Keyboard mode"
            aria-pressed={help.keyboard}
            onClick={() => setKeyboardMode(!help.keyboard)}
            className={look(help.keyboard)}
          >
            <Keyboard size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Keyboard mode: {help.keyboard ? "on" : "off"} (\)</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Keyboard shortcuts"
            aria-pressed={help.listShown}
            {...help.button}
            className={look(help.listShown)}
          >
            <BookKey size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Keyboard shortcuts (?)</p>
        </TooltipContent>
      </Tooltip>
      <ShortcutsDialog
        open={help.fullOpen}
        onOpenChange={help.onFullOpenChange}
        commandKey={commandKey}
      />
    </>
  )
}
