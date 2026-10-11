/**
 * PROTOTYPE variant B, "Scope first" (Zed / VS Code User-Workspace tabs).
 * The top-level split is where a value lives: this browser, my account, the
 * deployment. The account page absorbs `/settings` (profile, password,
 * usage). Personal settings save as you go; deployment settings affect
 * everybody, so they collect into a draft with an explicit Save bar.
 */
import { Building2, Monitor, User } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { toast } from "sonner"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import MyQuota from "@/components/UserSettings/MyQuota"
import UserInformation from "@/components/UserSettings/UserInformation"
import { useSettings } from "@/contexts/SettingsContext"
import useAuth from "@/hooks/useAuth"
import { useCanManageJobs } from "@/hooks/useJobsStatus"
import { valuesEqual } from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"
import { cn } from "@/lib/utils"
import {
  entryFor,
  NOT_A_ROW,
  PANEL_INFO,
  PROTO_GROUPS,
  SCOPE_HINT,
  SCOPE_LABEL,
  type Scope,
  scopeOf,
  sentenceCase,
} from "./model"
import { ProtoRow } from "./ProtoRow"
import { ProtoPanel } from "./panels"

const ICON: Record<Scope, React.FC<{ size?: number }>> = {
  browser: Monitor,
  account: User,
  deployment: Building2,
}

function rowsFor(scope: Scope) {
  return PROTO_GROUPS.map((g) => ({
    group: g,
    rows: g.rows
      .filter((id) => !NOT_A_ROW.has(id))
      .map(entryFor)
      .filter((e): e is SettingCatalogEntry => !!e && scopeOf(e) === scope),
    panels: g.panels.filter((p) => PANEL_INFO[p].scope === scope),
  })).filter((g) => g.rows.length + g.panels.length > 0)
}

type Ctx = Record<string, unknown>
const keyOf = (e: SettingCatalogEntry) => (e.sliceKey ?? e.id) as string
const setterOf = (s: Ctx, e: SettingCatalogEntry) => {
  const k = keyOf(e)
  return s[`set${k.charAt(0).toUpperCase()}${k.slice(1)}`] as (
    v: unknown,
  ) => void
}

export const VariantB: React.FC = () => {
  const [tab, setTab] = useState<Scope>("account")
  const isAdmin = useCanManageJobs()

  return (
    <div className="-m-8 flex h-full flex-col bg-app-card">
      <div className="border-b border-app-ink/10 px-8 pt-6">
        <h2 className="text-xl font-semibold">Settings</h2>
        <div className="mt-4 flex gap-2">
          {(["browser", "account", "deployment"] as const).map((s) => {
            const Icon = ICON[s]
            return (
              <button
                key={s}
                type="button"
                onClick={() => setTab(s)}
                className={cn(
                  "-mb-px flex max-w-64 flex-col items-start gap-0.5 border-b-2 px-4 pb-3 pt-2 text-left",
                  tab === s
                    ? "border-app-ink"
                    : "border-transparent text-app-ink/60 hover:text-app-ink",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Icon size={15} />
                  {SCOPE_LABEL[s]}
                  {s === "deployment" && !isAdmin ? (
                    <span className="text-[11px] font-normal text-app-ink/50">
                      read-only
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-app-ink/50">{SCOPE_HINT[s]}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 pb-32 pt-6">
          {tab === "browser" ? <ScopePage scope="browser" /> : null}
          {tab === "account" ? <AccountPage /> : null}
          {tab === "deployment" ? <DeploymentPage isAdmin={isAdmin} /> : null}
        </div>
      </div>
    </div>
  )
}

const Group: React.FC<{
  title: string
  blurb?: string
  children: React.ReactNode
}> = ({ title, blurb, children }) => (
  <section className="mb-10">
    <h3 className="text-base font-semibold">{title}</h3>
    {blurb ? <p className="text-[13px] text-app-ink/55">{blurb}</p> : null}
    <div className="mt-3 divide-y divide-app-ink/5 rounded-md border border-app-ink/10">
      {children}
    </div>
  </section>
)

const ScopePage: React.FC<{ scope: Scope }> = ({ scope }) => (
  <>
    {rowsFor(scope).map(({ group, rows, panels }) => (
      <Group key={group.id} title={group.label} blurb={group.blurb}>
        {rows.map((e) => (
          <ProtoRow key={e.id} entry={e} hideScope />
        ))}
        {panels.map((p) => (
          <ProtoPanel key={p} id={p} />
        ))}
      </Group>
    ))}
  </>
)

const AccountPage: React.FC = () => {
  const { user } = useAuth()
  return (
    <>
      <Group title="Profile">
        <div className="p-4">
          <UserInformation />
        </div>
      </Group>
      <Group title="Password">
        <div className="p-4">
          <ChangePassword />
        </div>
      </Group>
      <Group title="Usage" blurb="Telegram requests your account made today.">
        <div className="p-4">
          <MyQuota />
        </div>
      </Group>
      <ScopePage scope="account" />
      {!user?.is_superuser ? (
        <Group title="Danger zone">
          <div className="p-4">
            <DeleteAccount />
          </div>
        </Group>
      ) : null}
    </>
  )
}

const DeploymentPage: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const settings = useSettings() as unknown as Ctx
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const groups = rowsFor("deployment")
  const all = groups.flatMap((g) => g.rows)
  const dirty = all.filter(
    (e) => e.id in draft && !valuesEqual(draft[e.id], settings[keyOf(e)]),
  )

  const save = () => {
    for (const e of dirty) setterOf(settings, e)?.(draft[e.id])
    toast.success(`Saved ${dirty.length} deployment setting(s)`)
    setDraft({})
  }

  return (
    <>
      {!isAdmin ? (
        <div className="mb-6 rounded-md border border-violet-500/30 bg-violet-500/5 p-4 text-[13px]">
          These apply to everyone on this deployment. Your Admin sets them, so
          you can see them here but not change them.
        </div>
      ) : null}
      {groups.map(({ group, rows, panels }) => (
        <Group key={group.id} title={group.label} blurb={group.blurb}>
          {rows.map((e) => (
            <ProtoRow
              key={e.id}
              entry={e}
              hideScope
              value={e.id in draft ? draft[e.id] : settings[keyOf(e)]}
              onChange={(v) => setDraft((d) => ({ ...d, [e.id]: v }))}
            />
          ))}
          {panels.map((p) => (
            <ProtoPanel key={p} id={p} />
          ))}
        </Group>
      ))}
      {dirty.length > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-40 flex justify-center px-4">
          <div className="flex items-center gap-4 rounded-lg border border-app-ink/15 bg-app-card px-4 py-3 shadow-lg">
            <span className="text-sm">
              {dirty.length} unsaved change{dirty.length === 1 ? "" : "s"}:{" "}
              <span className="text-app-ink/60">
                {dirty.map((e) => sentenceCase(e.label)).join(", ")}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setDraft({})}
              className="rounded px-3 py-1.5 text-sm text-app-ink/70 hover:bg-app-ink/5"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded bg-app-ink px-3 py-1.5 text-sm font-semibold text-app-card"
            >
              Save for everyone
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
