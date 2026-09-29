import type { LucideIcon } from "lucide-react"
import type React from "react"

import { TgButton } from "@/components/ui/tg-button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"

/**
 * One row of the Action tab: name, controls, buttons.
 *
 * Every row sits on the same three columns so every Run button lands in one
 * column on the right, however much or little each action has to configure.
 * That alignment is the reason this is a component and not four copies of a
 * card: a fifth action is a new `<ActionRow>` and inherits it.
 *
 * `controls` holds anything that tunes the run (a mode switch first, then a
 * free-text input taking the rest of the line). `secondary` holds the
 * alternatives to running, as `ActionIconButton`s, so they stay narrow and
 * leave the primary button the only labelled one.
 */
export const ActionRow: React.FC<{
  icon: LucideIcon
  title: string
  description: string
  controls?: React.ReactNode
  secondary?: React.ReactNode
  primary: React.ReactNode
}> = ({ icon: Icon, title, description, controls, secondary, primary }) => (
  <li className="grid items-center gap-x-6 gap-y-3 p-4 md:grid-cols-[16rem_minmax(0,1fr)_auto]">
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-app-ink/5 text-app-ink/60">
        <Icon size={15} aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="text-[11px] leading-snug text-app-ink/60">
          {description}
        </p>
      </div>
    </div>
    <div className="flex min-w-0 items-center gap-3">{controls}</div>
    <div className="flex items-center justify-end gap-1">
      {secondary}
      <div className="ml-2 w-44 [&>*]:h-9 [&>*]:w-full">{primary}</div>
    </div>
  </li>
)

/** A secondary action: icon only, named by its label and a tooltip. */
export const ActionIconButton: React.FC<{
  icon: LucideIcon
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}> = ({ icon: Icon, label, hint, onClick, disabled, loading }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <TgButton
        variant="ghost"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        loading={loading}
        className="size-9 px-0"
      >
        {!loading && <Icon size={14} />}
      </TgButton>
    </TooltipTrigger>
    <TooltipContent>
      <p>{hint ?? label}</p>
    </TooltipContent>
  </Tooltip>
)

/** Sentence-case segments for a row's mode switch. */
export const ACTION_SWITCH_OPTION_CLASS =
  "normal-case tracking-normal text-[11px]"
