import { AlertTriangle, ChevronDown } from "lucide-react"
import { Popover } from "radix-ui"
import { useState } from "react"

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useSelectedAiKeyId } from "@/hooks/useAiKeys"
import { useAiModels } from "@/hooks/useAiModels"
import { rememberModelForKey } from "@/lib/aiKeys/modelMemory"
import { cn } from "@/lib/utils"

/**
 * Pick a model from what the provider offers, or type one (BYOK-02).
 *
 * A cmdk list in a popover: the chevron opens every model the selected Key's
 * provider returns, and typing narrows them. It replaced an `<input list>` with
 * a `<datalist>`, which was the right call while the requirement was only
 * "accept anything typed" — the platform control does that in zero lines. What
 * it cannot promise is the other half: several browsers will not open a
 * datalist on focus before a character is typed, and the filtering is the
 * browser's own, substring in Chrome and inconsistent in Safari. cmdk and
 * radix's `Popover` are both already in this tree (the command palette, and
 * `AnalysisWindowControl`), so this costs no dependency.
 *
 * **An id the catalogue does not list is allowed through.** A provider can
 * serve a model it does not advertise, so the `Use "…"` row commits whatever
 * was typed and the warning beside the value says only that we could not find
 * it — never that it is wrong, and never blocking a run. This replaced an
 * effect that *silently overwrote* such a value with the provider's first
 * model, which was correct for the case it was written for (a deployment-default
 * Gemini id against an OpenRouter-only Key) and destroyed every deliberately
 * typed id to get there.
 *
 * **The warning is suppressed when the catalogue is empty**, and that is the
 * load-bearing condition. A local Ollama or a bare vLLM serves no `/models`
 * route, the server answers `[]`, and every id is then "not in the list" — so a
 * naive check would paint a permanent warning on a correct model for exactly
 * the providers this feature exists to support. An empty catalogue means the
 * provider cannot be asked, which is evidence of nothing.
 *
 * With no Key selected there is no catalogue and no run, so the control is
 * disabled rather than offering a list it cannot fetch — **except where the
 * model it names is not paid for by the Account's Key.** Translation runs on the
 * Operator Key (ADR-016), so an Admin with no personal Key still has to be able
 * to name the deployment's translation model, and the "not in this key's list"
 * warning would be measuring the wrong Key's catalogue there. `operatorKey`
 * says which of the two a call site is, and it is a prop because the answer is
 * genuinely per-picker: three of the four name a model for an Artifact, and one
 * names a model for corpus-wide work.
 */
export const ModelCombo: React.FC<{
  value: string
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
  placeholder?: string
  /** This model runs on the Operator Key, not the Account's (ADR-016). */
  operatorKey?: boolean
}> = ({ value, onChange, className, ariaLabel, placeholder, operatorKey }) => {
  const { models: accountModels } = useAiModels()
  const selectedKeyId = useSelectedAiKeyId()
  const hasKey = operatorKey === true || selectedKeyId !== null
  // An Operator-Key picker gets no catalogue rather than the wrong one. The
  // models on offer come from the Account's own Key, and nothing here can ask
  // the Operator Key what it serves — there is no endpoint for it — so listing
  // the personal Key's models would invite somebody to pick an id the Key that
  // actually runs the job may not know. Free text is the honest control.
  const models = operatorKey ? [] : accountModels
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const unlisted =
    !operatorKey && models.length > 0 && !models.some((m) => m.id === value)
  const typed = search.trim()
  const offerTyped = typed !== "" && !models.some((m) => m.id === typed)

  const commit = (next: string) => {
    // An empty field never commits: the last good value stands. Nothing repairs
    // a blank model id any more, so this is the only thing between a cleared
    // field and a request naming no model at all.
    const chosen = next.trim()
    if (chosen) {
      onChange(chosen)
      // Recorded here rather than at the three call sites, because this is the
      // one funnel every deliberate model choice passes through. The Operator
      // Key's picker is excluded for the same reason it shows no catalogue: the
      // model it names is not the Account Key's business.
      if (!operatorKey) rememberModelForKey(selectedKeyId, chosen)
    }
    setSearch("")
    setOpen(false)
  }

  // **Closing never commits.** An earlier draft committed the box's contents on
  // any close but Escape, on the theory that it matched the plain input this
  // replaced. It does not: that input's text *was* the value, and this one is a
  // filter. Narrowing the list to `gpt` and then clicking anywhere else on the
  // page would have silently rewritten a working model id to `gpt`. Enter and
  // the `Use "…"` row are the two ways in, and both are deliberate.
  const onOpenChange = (next: boolean) => {
    setSearch("")
    setOpen(next)
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={!hasKey}
          title={hasKey ? undefined : "Add a key first"}
          className={cn(
            "flex items-center gap-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="truncate">
            {hasKey ? value || placeholder || "MODEL ID" : "Add a key first"}
          </span>
          {hasKey && unlisted && (
            <span
              data-testid="model-unlisted-warning"
              title="Not in this key's model list. It will still be used."
              className="flex shrink-0 items-center text-amber-500"
            >
              <AlertTriangle size={12} aria-hidden="true" />
              <span className="sr-only">
                Not in this key's model list. It will still be used.
              </span>
            </span>
          )}
          <ChevronDown
            size={12}
            aria-hidden="true"
            className="shrink-0 opacity-40"
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-app-ink/10 bg-app-card p-0 shadow-xl"
        >
          <Command>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder="Filter or type a model id…"
            />
            <CommandList>
              {offerTyped && (
                <CommandItem
                  value={typed}
                  onSelect={() => commit(typed)}
                  className="font-mono text-xs"
                >
                  Use "{typed}"
                </CommandItem>
              )}
              {/* Only reachable with an empty box: any typed text that matches
                  no model puts the `Use "…"` row above, and that row matches
                  the search by construction. */}
              <CommandEmpty>
                {operatorKey
                  ? "Runs on the deployment's key. Type a model id it serves."
                  : "This provider serves no model list. Type an id."}
              </CommandEmpty>
              {models.map((m) => (
                <CommandItem
                  key={m.id}
                  value={m.id}
                  onSelect={() => commit(m.id)}
                  className="font-mono text-xs"
                >
                  {m.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
