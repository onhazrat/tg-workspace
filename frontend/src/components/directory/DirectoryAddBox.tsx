import { Plus } from "lucide-react"
import { useState } from "react"
import type { DirectoryAddResponse } from "@/client"
import { HandlePasteBox } from "@/components/HandlePasteBox"
import { pillClass } from "@/components/PostFilterParts"
import type { PastedHandle } from "@/lib/channels/paste-handles"

/** The server's cap on one paste (`MAX_ADDED_HANDLES`). */
export const MAX_ADDED_HANDLES = 100_000

const n = (count: number) => count.toLocaleString("en-US")

/** The server's answer as one line: what was queued, held, or refused. */
export function addResult({
  added,
  alreadyInDirectory,
  invalid,
}: DirectoryAddResponse): string {
  return [
    `Added ${n(added)}`,
    `${n(alreadyInDirectory)} already in the Directory`,
    `${n(invalid)} ${invalid === 1 ? "not a handle" : "not handles"}`,
  ].join(" · ")
}

export type DirectoryAddBoxProps = {
  /** Sends the handles; resolves to the server's counts, or null on failure. */
  onAdd: (handles: string[]) => Promise<DirectoryAddResponse | null>
}

/**
 * Add to Directory (DADD): paste handles or t.me links and queue them for a
 * fetch without following any. The box cannot know which the Directory holds,
 * so the server's counts say so after the click. `DATA_ADMIN` only; the caller
 * decides that.
 */
export function DirectoryAddBox({ onAdd }: DirectoryAddBoxProps) {
  const [result, setResult] = useState<DirectoryAddResponse | null>(null)
  // Every row, the ones the box marked invalid too, so the server's count of
  // "not handles" is the whole paste's and not only its reserved paths.
  const add = async (rows: PastedHandle[]) => {
    const answer = await onAdd(rows.map((r) => r.handle))
    setResult(answer)
    return answer !== null
  }
  return (
    <HandlePasteBox
      trigger={
        <button
          type="button"
          data-testid="directory-add"
          className={pillClass(false)}
        >
          <Plus size={12} /> Add to Directory
        </button>
      }
      labels={{ new: "will add", known: "will add", invalid: "not a handle" }}
      label="Handles to add to the Directory"
      verb="Add"
      testId="directory-add"
      max={MAX_ADDED_HANDLES}
      onSubmit={add}
      status={
        result && (
          <p
            data-testid="directory-add-result"
            className="mt-1 px-1 text-[11px] text-app-ink/60"
          >
            {addResult(result)}
          </p>
        )
      }
    />
  )
}
