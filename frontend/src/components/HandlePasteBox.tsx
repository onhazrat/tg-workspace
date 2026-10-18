import { type ReactElement, type ReactNode, useState } from "react"
import { BarHeading, BarPopover } from "@/components/BarPopover"
import { TgButton } from "@/components/ui/tg-button"
import {
  type PastedHandle,
  parsePastedHandles,
} from "@/lib/channels/paste-handles"

/** Rows drawn under the paste; a 100,000-line paste would freeze the popover. */
const SHOWN_ROWS = 200

const STATUS_CLASS: Record<PastedHandle["status"], string> = {
  new: "text-green-600",
  known: "text-app-ink/50",
  invalid: "text-red-500",
}

export type HandlePasteBoxProps = {
  trigger: ReactElement
  /** Handles the caller already has, marked rather than sent. */
  known?: string[]
  /** What each row reads, by its status. */
  labels: Record<PastedHandle["status"], string>
  /** The textarea's accessible name. */
  label: string
  /** The submit button's verb, followed by how many it sends. */
  verb: string
  /** Prefix of the rows' and the submit button's test ids. */
  testId: string
  /** Controls beside the submit button, such as a Setting group. */
  extra?: ReactNode
  /** A line under the rows: progress, or what the last submit did. */
  status?: ReactNode
  /** The most rows one paste may hold, matching a server's cap on what it is
   * sent (every row the box parsed, invalid ones included). */
  max?: number
  /** Sends the parsed rows (the caller picks which); resolves true when the
   * paste can be cleared. Called only when some row is new. */
  onSubmit: (rows: PastedHandle[]) => Promise<boolean>
}

/**
 * Paste any number of handles or t.me links, see each one's fate, and send the
 * new ones in one click: the Channels tab's Follow (CTB-05) and the
 * Directory's Add (DADD). A submit that fails keeps the paste.
 */
export function HandlePasteBox({
  trigger,
  known = [],
  labels,
  label,
  verb,
  testId,
  extra,
  status,
  max = Number.POSITIVE_INFINITY,
  onSubmit,
}: HandlePasteBoxProps) {
  const [text, setText] = useState("")
  const [running, setRunning] = useState(false)
  const parsed = parsePastedHandles(text, known)
  const fresh = parsed.filter((p) => p.status === "new").length
  const over = parsed.length > max

  const submit = async () => {
    setRunning(true)
    try {
      if (await onSubmit(parsed)) setText("")
    } finally {
      setRunning(false)
    }
  }

  return (
    <BarPopover width="w-96" trigger={trigger}>
      <BarHeading>
        Handles or t.me links, separated by lines, spaces or commas
      </BarHeading>
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the popover opens to paste into.
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={label}
        placeholder={"@durov\nhttps://t.me/telegram\nt.me/s/bbcpersian"}
        rows={4}
        className="w-full resize-y rounded-lg border border-app-ink/15 bg-app-muted p-2 font-mono text-[11px] outline-none focus:border-app-ink/40"
      />
      {parsed.length > 0 && (
        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto px-1">
          {parsed.slice(0, SHOWN_ROWS).map((p) => (
            <li
              key={p.handle.toLowerCase()}
              data-testid={`${testId}-row`}
              className={`text-[11px] font-semibold ${STATUS_CLASS[p.status]}`}
            >
              @{p.handle} · {labels[p.status]}
            </li>
          ))}
          {parsed.length > SHOWN_ROWS && (
            <li className="text-[11px] text-app-ink/50">
              and {(parsed.length - SHOWN_ROWS).toLocaleString("en-US")} more
            </li>
          )}
        </ul>
      )}
      {over && (
        <p
          data-testid={`${testId}-over`}
          className="mt-1 px-1 text-[11px] text-red-500"
        >
          At most {max.toLocaleString("en-US")} at once; split the paste
        </p>
      )}
      {status}
      <div className="mt-2 flex items-center gap-2 px-1 text-[11px] font-semibold">
        {extra}
        <TgButton
          size="sm"
          data-testid={`${testId}-submit`}
          disabled={fresh === 0 || over || running}
          onClick={() => void submit()}
        >
          {verb} {fresh.toLocaleString("en-US")}
        </TgButton>
      </div>
    </BarPopover>
  )
}
