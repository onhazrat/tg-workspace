/**
 * When Directory entries are fetched again (DRP-01, ADR-045): the Refresh
 * target and the shortest and longest wait, edited together with what they
 * would cost. The projection is the Refreshes a day the drafted values ask
 * for, beside the Directory probe Requests the deployment actually made each
 * day last week. It reads every live entry, so it is asked only once a value
 * is edited, debounced, and never when the page opens. The three
 * `directory.deployment.refresh*` Settings are shown here instead of as rows.
 */
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  type DirectoryRefreshProjectionResponse,
  dataProjectDirectoryRefresh,
} from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import { queryKeys } from "@/hooks/queryKeys"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { fmt } from "@/lib/requests/breakdown"
import { extractErrorMessage } from "@/utils"
import { FormError, fieldClass, Note } from "./kit"
import { useSettingsRegistry } from "./registry"

export interface RefreshPolicy {
  target: number
  minDays: number
  maxDays: number
}
type Field = keyof RefreshPolicy

export const REFRESH_SETTING_IDS: Record<Field, string> = {
  target: "directory.deployment.refreshTarget",
  minDays: "directory.deployment.refreshMinDays",
  maxDays: "directory.deployment.refreshMaxDays",
}

const FIELDS: readonly { field: Field; label: string; unit: string }[] = [
  { field: "target", label: "Refresh target", unit: "new Posts" },
  { field: "minDays", label: "Shortest wait", unit: "days" },
  { field: "maxDays", label: "Longest wait", unit: "days" },
]

type Drafts = Record<Field, string>

const draftsOf = (p: RefreshPolicy): Drafts => ({
  target: String(p.target),
  minDays: String(p.minDays),
  maxDays: String(p.maxDays),
})

/** The drafts as a policy, or why they cannot be one. The server checks again. */
export function parsePolicy(drafts: Drafts): RefreshPolicy | string {
  const n = (field: Field) => Number(drafts[field])
  for (const { field, label } of FIELDS) {
    const value = n(field)
    if (drafts[field].trim() === "" || !Number.isInteger(value) || value < 1)
      return `${label} is a whole number of at least 1.`
  }
  if (n("target") > 1000) return "Refresh target is at most 1000."
  if (n("minDays") > n("maxDays"))
    return "The shortest wait between Refreshes is at most the longest."
  return { target: n("target"), minDays: n("minDays"), maxDays: n("maxDays") }
}

/**
 * The changed fields in an order the server accepts one at a time: each
 * write is checked against what is stored, so a longest wait dropping below
 * the stored shortest goes after the shortest, and otherwise before it.
 */
export function writeOrder(saved: RefreshPolicy, next: RefreshPolicy): Field[] {
  const order: Field[] =
    next.maxDays < saved.minDays
      ? ["target", "minDays", "maxDays"]
      : ["target", "maxDays", "minDays"]
  return order.filter((field) => next[field] !== saved[field])
}

export function RefreshPolicyForm({
  saved,
  projection,
  onDraft,
  onSave,
}: {
  saved: RefreshPolicy
  /** For the drafted values; `null` until a value is edited. */
  projection: DirectoryRefreshProjectionResponse | null
  onDraft: (policy: RefreshPolicy | null) => void
  onSave: (policy: RefreshPolicy) => Promise<void>
}) {
  const [drafts, setDrafts] = useState(() => draftsOf(saved))
  const [saving, setSaving] = useState(false)
  useEffect(() => setDrafts(draftsOf(saved)), [saved])
  const parsed = parsePolicy(drafts)
  const policy = typeof parsed === "string" ? null : parsed
  const dirty =
    policy !== null &&
    FIELDS.some(({ field }) => policy[field] !== saved[field])
  const draftKey = dirty ? JSON.stringify(policy) : null
  useEffect(
    () => onDraft(draftKey === null ? null : JSON.parse(draftKey)),
    [draftKey, onDraft],
  )

  const save = async () => {
    if (!policy) return
    setSaving(true)
    try {
      await onSave(policy)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        {FIELDS.map(({ field, label, unit }) => (
          <label key={field} className="flex flex-col gap-1 text-[11px]">
            <span className="text-app-ink/60">{label}</span>
            <span className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                aria-label={label}
                value={drafts[field]}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [field]: e.target.value }))
                }
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === "Enter" && dirty) void save()
                }}
                className={`${fieldClass} w-20 text-right tabular-nums`}
              />
              <span className="text-app-ink/50">{unit}</span>
            </span>
          </label>
        ))}
        <TgButton
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void save()}
          data-testid="refresh-policy-save"
        >
          Save
        </TgButton>
      </div>
      <FormError>{typeof parsed === "string" ? parsed : null}</FormError>
      <p className="text-[12px]" data-testid="refresh-projection">
        {!dirty
          ? "Edit a value to see the Refreshes a day it would cost."
          : projection === null
            ? "Projecting…"
            : `About ${fmt(Math.round(projection.refreshesPerDay))} Refreshes a day: ${fmt(projection.atMin)} entries wait the shortest, ${fmt(projection.atMax)} the longest. Directory probes made ${fmt(Math.round(projection.measuredPerDay))} Requests a day last week, new handles included.`}
      </p>
      <Note>
        An entry comes due once its Channel has likely published the Refresh
        target in new Posts since it was last fetched, never sooner than the
        shortest wait and never later than the longest. Saving moves every
        entry's next Refresh at once.
      </Note>
    </div>
  )
}

export function DirectoryRefresh() {
  const registry = useSettingsRegistry()
  const rowOf = (field: Field) =>
    registry.rows.find((r) => r.id === REFRESH_SETTING_IDS[field])
  const rows = FIELDS.map(({ field }) => rowOf(field))
  const [target, minDays, maxDays] = rows.map((row) => Number(row?.value))
  const saved = useMemo(
    () => ({ target, minDays, maxDays }),
    [target, minDays, maxDays],
  )
  const [draft, setDraft] = useState<RefreshPolicy | null>(null)
  const asked = useDebouncedValue(draft, 400)
  const projection = useQuery({
    queryKey: queryKeys.directoryRefreshProjection(asked ?? {}),
    queryFn: () =>
      dataProjectDirectoryRefresh({ query: asked as RefreshPolicy }),
    enabled: asked !== null,
  })
  if (rows.some((row) => row === undefined)) return null
  const onSave = async (next: RefreshPolicy) => {
    try {
      for (const field of writeOrder(saved, next)) {
        const row = rowOf(field)
        if (row) await registry.save(row, next[field])
      }
      toast.success("Refresh settings saved; due dates moved.")
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }
  return (
    <RefreshPolicyForm
      saved={saved}
      projection={draft && asked === draft ? (projection.data ?? null) : null}
      onDraft={setDraft}
      onSave={onSave}
    />
  )
}
