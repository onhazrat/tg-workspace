/**
 * The Account's AI keys (SET-03): a table and an Add key form. The form is
 * `AiKeyAddForm`, the one the Action tab's run bar opens too, so the provider
 * rules have one copy. There is no re-check action on purpose; that form's
 * old panel says why (a check spends the Account's money).
 */
import { useState } from "react"
import { AiKeyAddForm } from "@/components/ai/AiKeyAddForm"
import { RelativeTime } from "@/components/RelativeTime"
import { useAiKeys, useRefreshAiKeys } from "@/hooks/useAiKeys"
import { type AiKey, deleteAiKey } from "@/lib/aiKeys/store"
import {
  ConfirmButton,
  cellClass,
  FormPill,
  ListTable,
  rowClass,
  Status,
} from "./kit"

export function AiKeysTable({
  keys,
  onDelete,
}: {
  keys: AiKey[]
  onDelete: (id: string) => Promise<unknown>
}) {
  return (
    <ListTable
      columns={[
        { label: "Key" },
        { label: "Provider" },
        { label: "Status" },
        { label: "" },
      ]}
      isEmpty={!keys.length}
      empty="No keys yet. Summaries need one."
    >
      {keys.map((k) => (
        <tr key={k.id} className={rowClass}>
          <td className={`${cellClass} font-semibold`}>{k.label}</td>
          <td className={`${cellClass} font-mono text-[11px] text-app-ink/60`}>
            {k.baseUrl ?? k.provider}
          </td>
          <td className={cellClass}>
            {k.lastValidated ? (
              <Status tone="ok">
                Verified <RelativeTime timestamp={k.lastValidated} />
              </Status>
            ) : (
              <Status tone="warn">Not verified, still used</Status>
            )}
          </td>
          <td className={`${cellClass} text-right`}>
            <ConfirmButton
              label={`Delete ${k.label}`}
              title={`Delete ${k.label}?`}
              description="A scheduled Summary that uses it fails until it is given another key."
              confirmLabel="Delete"
              onConfirm={() => onDelete(k.id)}
            />
          </td>
        </tr>
      ))}
    </ListTable>
  )
}

export function AiKeys() {
  const keys = useAiKeys()
  const refresh = useRefreshAiKeys()
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <FormPill
        label="Add key"
        heading="A provider key, used for your Summaries, Chats and Tags"
        open={open}
        onOpenChange={setOpen}
      >
        <AiKeyAddForm onSaved={() => setOpen(false)} />
      </FormPill>
      <AiKeysTable
        keys={keys}
        onDelete={async (id) => {
          await deleteAiKey(id)
          await refresh()
        }}
      />
    </div>
  )
}
