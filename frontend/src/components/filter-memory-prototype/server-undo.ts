// PROTOTYPE (filter-memory): never merge. F's server actions: every write the
// app sends goes through `fetch`, so one wrapper sees them all. A write with a
// rule reads what it is about to change, and once it succeeds becomes a
// timeline row holding the requests that take it back (`undo`) and send it
// again (`redo`). A write with no rule is a row that cannot be undone; reads
// sent as POST and background writes pass unrecorded.
//
// ponytail: inverses are written per route from the request and a read made
// just before it; a real version wants the server to return the inverse.

import { API_BASE, headers } from "@/api/base"
import { queryClient } from "@/lib/queryClient"
import type { Channel } from "@/types"

export type Req = { method: string; path: string; body?: unknown }
export type Action = {
  label: string
  /** Null: this cannot be undone (a sync, an AI run, a publish). */
  undo: Req[] | null
  redo: Req[]
}

const original = globalThis.fetch.bind(globalThis)
/** While positive, or until this time, writes pass unrecorded: undo and redo themselves. */
let quiet = 0
let quietUntil = 0
export const hush = (ms = 800) => {
  quietUntil = Date.now() + ms
}

let listener: ((a: Action) => void) | null = null
/** F listens while it is mounted; with no listener the wrapper only passes through. */
export const onAction = (l: ((a: Action) => void) | null) => {
  listener = l
}

async function call(method: string, path: string, body?: unknown) {
  const res = await original(`${API_BASE}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`)
  return res.status === 204 ? null : res.json().catch(() => null)
}
const get = (path: string) => call("GET", path).catch(() => undefined)

/** Sends the requests in order; `$prev.id` in one is the id the last one returned. */
export async function run(reqs: Req[]) {
  quiet++
  try {
    let prev: { id?: string } | null = null
    for (const r of reqs) {
      const text = JSON.stringify(r).replaceAll("$prev.id", prev?.id ?? "")
      const { method, path, body } = JSON.parse(text) as Req
      prev = await call(method, path, body)
    }
  } finally {
    quiet--
  }
}

// ---- What each write changed, and how to take it back --------------------

const channels = () =>
  (queryClient.getQueryData<Channel[]>(["channels"]) ?? []) as Channel[]
const channel = (id: string) =>
  channels().find((c) => c.id === id || c.name === id)
const tagNames = (c: Channel | undefined) =>
  (c?.tags ?? []).map((t) => (typeof t === "string" ? t : t.name))
/** The fields of `from` that `keys` names, null where `from` had none. */
const pick = (from: object | undefined, keys: string[]) =>
  Object.fromEntries(
    keys.map((k) => [k, (from as Record<string, unknown>)?.[k] ?? null]),
  )
/** What a Channel upsert accepts; the server manages `language` and `telegramChatId`. */
const UPSERT_FIELDS = [
  "name",
  "displayName",
  "photoUrl",
  "bio",
  "subscribers",
  "photos",
  "videos",
  "files",
  "links",
  "startId",
  "startTime",
  "tags",
  "followedAt",
  "discoveredVia",
]
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
/** Channels by the value of `key` they had, one request per value. */
function byPrevious(ids: string[], key: (c: Channel | undefined) => string) {
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const k = key(channel(id))
    groups.set(k, [...(groups.get(k) ?? []), id])
  }
  return groups
}

type Ctx = {
  path: string
  m: RegExpMatchArray
  // biome-ignore lint/suspicious/noExplicitAny: request bodies of every shape
  body: any
  // biome-ignore lint/suspicious/noExplicitAny: whatever the read returned
  before: any
  // biome-ignore lint/suspicious/noExplicitAny: the write's own response
  out: any
}
type Rule = {
  method: string
  re: RegExp
  // biome-ignore lint/suspicious/noExplicitAny: see Ctx
  before?: (m: RegExpMatchArray, body: any) => unknown
  make: (c: Ctx) => Action | null
}
const STAR_KEYS = new Set(["isStarred", "note"])
const flagsOnly = (body: object) =>
  Object.keys(body ?? {}).length > 0 &&
  Object.keys(body).every((k) => STAR_KEYS.has(k))

const KIND_WORD: Record<string, string> = {
  summaries: "summary",
  "chat-sessions": "chat",
  "tag-runs": "tag run",
}

/**
 * A deleted summary, chat or tag run comes back in two writes: the submit
 * that freezes its Scope (only a submit sets one), then the upsert with the rest.
 */
function restoreArtifact(
  kind: string,
  path: string,
  // biome-ignore lint/suspicious/noExplicitAny: an artifact as the server read it
  before: any,
): Req[] {
  const { scope, ...rest } = before
  const submit = scope
    ? {
        id: before.id,
        language: before.language,
        model: before.model,
        ...(kind === "chat-sessions" && { mode: before.mode }),
        ...(kind === "tag-runs" && {
          mode: before.mode,
          source: before.source,
          status: before.status,
        }),
        scope: {
          channels: scope.channels,
          viewMeasure: scope.viewMeasure,
          sort: scope.sort,
          groupByChannel: scope.groupByChannel,
          selection: scope.selection,
          window: { mode: "fixed", start: scope.start, end: scope.end },
        },
      }
    : null
  return [
    ...(submit
      ? [{ method: "POST", path: `/api/v1/data/${kind}`, body: submit }]
      : []),
    { method: "PUT", path, body: rest },
  ]
}

const RULES: Rule[] = [
  // Channels
  {
    method: "PUT",
    re: /^\/api\/v1\/data\/channels\/([^/]+)$/,
    before: (m) => channel(decodeURIComponent(m[1])),
    make: ({ path, body, before, m }) => {
      const id = decodeURIComponent(m[1])
      if (!before)
        return {
          label: `Followed ${id}`,
          undo: [{ method: "DELETE", path }],
          redo: [{ method: "PUT", path, body }],
        }
      const keys = Object.keys(body ?? {})
      return {
        label: `Edited ${id} (${keys.join(", ")})`,
        undo: [{ method: "PUT", path, body: pick(before, keys) }],
        redo: [{ method: "PUT", path, body }],
      }
    },
  },
  {
    method: "DELETE",
    re: /^\/api\/v1\/data\/channels\/([^/]+)$/,
    before: (m) => channel(decodeURIComponent(m[1])),
    make: ({ path, before, m }) => ({
      label: `Unfollowed ${decodeURIComponent(m[1])}`,
      // A re-follow takes the fields an upsert accepts, then its Setting group back.
      undo: before
        ? [
            {
              method: "PUT",
              path,
              body: pick(before, UPSERT_FIELDS),
            },
            ...(before.settingGroupId
              ? [
                  {
                    method: "PATCH",
                    path: "/api/v1/data/channels/bulk-setting-group",
                    body: {
                      channelIds: [before.id],
                      settingGroupId: before.settingGroupId,
                    },
                  },
                ]
              : []),
          ]
        : null,
      redo: [{ method: "DELETE", path }],
    }),
  },
  {
    method: "POST",
    re: /^\/api\/v1\/data\/channels\/bulk-follow$/,
    make: ({ path, body }) => {
      const names: string[] = (body?.channels ?? []).map(
        (c: { name: string }) => c.name,
      )
      return {
        label: `Followed ${plural(names.length, "Channel")}`,
        undo: names.map((n) => ({
          method: "DELETE",
          path: `/api/v1/data/channels/${encodeURIComponent(n)}`,
        })),
        redo: [{ method: "POST", path, body }],
      }
    },
  },
  {
    method: "PATCH",
    re: /^\/api\/v1\/data\/channels\/bulk-setting-group$/,
    before: (_m, body) =>
      byPrevious(body.channelIds, (c) => c?.settingGroupId ?? ""),
    make: ({ path, body, before }) => ({
      label: `Moved ${plural(body.channelIds.length, "Channel")} to a Setting group`,
      undo: [...(before as Map<string, string[]>)]
        .filter(([group]) => group)
        .map(([settingGroupId, channelIds]) => ({
          method: "PATCH",
          path,
          body: { channelIds, settingGroupId },
        })),
      redo: [{ method: "PATCH", path, body }],
    }),
  },
  {
    method: "PATCH",
    re: /^\/api\/v1\/data\/channels\/bulk-sync-settings$/,
    before: (_m, body) => {
      const keys = Object.keys(body).filter((k) => k !== "channelIds")
      return byPrevious(body.channelIds ?? [], (c) =>
        JSON.stringify(pick(c, keys)),
      )
    },
    make: ({ path, body, before }) => ({
      label: `Changed sync settings on ${plural((body.channelIds ?? []).length, "Channel")}`,
      undo: [...(before as Map<string, string[]>)].map(
        ([values, channelIds]) => ({
          method: "PATCH",
          path,
          body: { channelIds, ...JSON.parse(values) },
        }),
      ),
      redo: [{ method: "PATCH", path, body }],
    }),
  },
  {
    method: "PATCH",
    re: /^\/api\/v1\/data\/channels\/bulk-tags$/,
    before: (_m, body) =>
      (body.updates ?? []).map((u: { channelId: string }) => ({
        channelId: u.channelId,
        tags: channel(u.channelId)?.tags ?? [],
      })),
    make: ({ path, body, before }) => ({
      label: `Changed tags on ${plural((body.updates ?? []).length, "Channel")}`,
      undo: [{ method: "PATCH", path, body: { updates: before } }],
      redo: [{ method: "PATCH", path, body }],
    }),
  },
  // Directory and Discover
  {
    method: "POST",
    re: /^\/api\/v1\/data\/discover\/ignored$/,
    make: ({ path, body, out }) => {
      const handles: string[] = out?.ignored ?? body?.handles ?? []
      return {
        label: `Dismissed ${plural(handles.length, "Channel")}`,
        undo: handles.length
          ? [{ method: "DELETE", path, body: { handles } }]
          : null,
        redo: [{ method: "POST", path, body: { handles } }],
      }
    },
  },
  {
    method: "DELETE",
    re: /^\/api\/v1\/data\/discover\/ignored$/,
    make: ({ path, body }) => ({
      label: `Took back ${plural((body?.handles ?? []).length, "dismissal")}`,
      undo: [{ method: "POST", path, body: { handles: body.handles } }],
      redo: [{ method: "DELETE", path, body }],
    }),
  },
  // Settings
  {
    method: "PUT",
    re: /^\/api\/v1\/data\/settings\/([^/]+)$/,
    before: (m) => get(`/api/v1/data/settings/${m[1]}`),
    make: ({ path, body, before, m }) => ({
      label: `Changed the ${decodeURIComponent(m[1])} Setting`,
      undo: before ? [{ method: "PUT", path, body: before }] : null,
      redo: [{ method: "PUT", path, body }],
    }),
  },
  {
    method: "PUT",
    re: /^\/api\/v1\/settings\/([^/]+)$/,
    before: async (m) => {
      const reg = (await get("/api/v1/settings/registry")) as
        | { rows?: { id: string; value?: unknown }[] }
        | undefined
      return reg?.rows?.find((r) => r.id === decodeURIComponent(m[1]))
    },
    make: ({ path, body, before, m }) => ({
      label: `Changed ${decodeURIComponent(m[1])}`,
      undo: before
        ? [{ method: "PUT", path, body: { value: before.value } }]
        : null,
      redo: [{ method: "PUT", path, body }],
    }),
  },
  {
    method: "POST",
    re: /^\/api\/v1\/data\/setting-groups$/,
    make: ({ path, body, out }) => ({
      label: `Created the Setting group ${body?.name ?? ""}`,
      undo: out?.id ? [{ method: "DELETE", path: `${path}/${out.id}` }] : null,
      redo: [{ method: "POST", path, body }],
    }),
  },
  {
    method: "PUT",
    re: /^\/api\/v1\/data\/setting-groups\/([^/]+)$/,
    before: async (m) =>
      (
        (await get("/api/v1/data/setting-groups")) as
          | { id: string }[]
          | undefined
      )?.find((g) => g.id === m[1]),
    make: ({ path, body, before }) => ({
      label: `Edited the Setting group ${before?.name ?? ""}`,
      undo: before
        ? [{ method: "PUT", path, body: pick(before, Object.keys(body)) }]
        : null,
      redo: [{ method: "PUT", path, body }],
    }),
  },
  {
    method: "DELETE",
    re: /^\/api\/v1\/data\/setting-groups\/([^/]+)$/,
    before: async (m) => ({
      group: (
        (await get("/api/v1/data/setting-groups")) as
          | { id: string }[]
          | undefined
      )?.find((g) => g.id === m[1]),
      channelIds: channels()
        .filter((c) => c.settingGroupId === m[1])
        .map((c) => c.id),
    }),
    make: ({ path, before }) => {
      const { id, createdAt, updatedAt, isDefault, isReserved, ...fields } =
        before.group ?? {}
      return {
        label: `Deleted the Setting group ${fields.name ?? ""}`,
        undo: before.group
          ? [
              {
                method: "POST",
                path: "/api/v1/data/setting-groups",
                body: fields,
              },
              ...(before.channelIds.length
                ? [
                    {
                      method: "PATCH",
                      path: "/api/v1/data/channels/bulk-setting-group",
                      body: {
                        channelIds: before.channelIds,
                        settingGroupId: "$prev.id",
                      },
                    },
                  ]
                : []),
            ]
          : null,
        redo: [{ method: "DELETE", path }],
      }
    },
  },
  // Tags
  {
    method: "PATCH",
    re: /^\/api\/v1\/data\/tags$/,
    make: ({ path, body }) => ({
      label: `Renamed the tag ${body.name} to ${body.to}`,
      undo: [{ method: "PATCH", path, body: { name: body.to, to: body.name } }],
      redo: [{ method: "PATCH", path, body }],
    }),
  },
  {
    method: "DELETE",
    re: /^\/api\/v1\/data\/tags$/,
    before: (_m, body) =>
      channels()
        .filter((c) => tagNames(c).includes(body.name))
        .map((c) => c.name),
    make: ({ path, body, before }) => ({
      label: `Deleted the tag ${body.name}`,
      undo: before.length
        ? [
            {
              method: "POST",
              path: "/api/v1/data/tags/channels",
              body: { name: body.name, handles: before },
            },
          ]
        : null,
      redo: [{ method: "DELETE", path, body }],
    }),
  },
  {
    method: "POST",
    re: /^\/api\/v1\/data\/tags\/channels$/,
    before: (_m, body) =>
      (body.handles ?? []).filter(
        (h: string) => !tagNames(channel(h)).includes(body.name),
      ),
    make: ({ path, body, before }) => ({
      label: `Tagged ${body.handles ? plural(body.handles.length, "Channel") : "a Directory view"} ${body.name}`,
      // A view-wide tag says only how many it changed, not which.
      undo:
        body.handles && before.length
          ? [
              {
                method: "DELETE",
                path,
                body: { name: body.name, handles: before },
              },
            ]
          : null,
      redo: [{ method: "POST", path, body }],
    }),
  },
  {
    method: "DELETE",
    re: /^\/api\/v1\/data\/tags\/channels$/,
    before: (_m, body) =>
      (body.handles ?? []).filter((h: string) =>
        tagNames(channel(h)).includes(body.name),
      ),
    make: ({ path, body, before }) => ({
      label: `Untagged ${plural((body.handles ?? []).length, "Channel")} ${body.name}`,
      undo:
        body.handles && before.length
          ? [
              {
                method: "POST",
                path,
                body: { name: body.name, handles: before },
              },
            ]
          : null,
      redo: [{ method: "DELETE", path, body }],
    }),
  },
  // Artifacts: a star or a note, and a delete put back from the copy read before it
  ...Object.keys(KIND_WORD).flatMap((kind): Rule[] => {
    const re = new RegExp(`^/api/v1/data/${kind}/([^/]+)$`)
    return [
      {
        method: "PUT",
        re,
        before: (_m, body) => (flagsOnly(body) ? get(_m[0]) : undefined),
        make: ({ path, body, before }) =>
          flagsOnly(body)
            ? {
                label:
                  "isStarred" in body
                    ? `${body.isStarred ? "Starred" : "Unstarred"} a ${KIND_WORD[kind]}`
                    : `Edited a ${KIND_WORD[kind]} note`,
                undo: before
                  ? [
                      {
                        method: "PUT",
                        path,
                        body: pick(before, Object.keys(body)),
                      },
                    ]
                  : null,
                redo: [{ method: "PUT", path, body }],
              }
            : null,
      },
      {
        method: "DELETE",
        re,
        before: (m) => get(m[0]),
        make: ({ path, before }) => ({
          label: `Deleted a ${KIND_WORD[kind]}`,
          undo: before ? restoreArtifact(kind, path, before) : null,
          redo: [{ method: "DELETE", path }],
        }),
      },
    ]
  }),
  {
    method: "PUT",
    re: /^\/api\/v1\/data\/discover\/reports\/([^/]+)\/flags$/,
    before: (m) => get(`/api/v1/data/discover/reports/${m[1]}`),
    make: ({ path, body, before }) => ({
      label:
        "isStarred" in body
          ? `${body.isStarred ? "Starred" : "Unstarred"} a Discover report`
          : "Edited a Discover report note",
      undo: before
        ? [{ method: "PUT", path, body: pick(before, Object.keys(body)) }]
        : null,
      redo: [{ method: "PUT", path, body }],
    }),
  },
]

/** Writes the app sends on its own or that only read: never a row. */
const SILENT = [
  /\/data\/posts(\/(chain|lookup|counts|facets|value-histogram|window-check|window-histogram|bulk))?$/,
  /\/data\/discover\/candidates$/,
  /\/data\/directory\/(list|count|distribution|handles|why)$/,
  /\/data\/tags\/(order|uses)$/,
  /\/data\/(translations|embeddings)$/,
  /\/data\/logs\/[^/]+$/,
  /\/data\/summaries\/[^/]+\/failures$/,
  /\/data\/(summaries|chat-sessions|tag-runs)\/[^/]+$/, // a run saving itself, unless a rule took it
  /\/ai\//,
  /\/rag\//,
  /\/telegram\/(channel-info|bot-info|resolve-start-time)$/,
  /\/login\//,
  /\/network\/test-proxy$/,
  /\/view-as\/[^/]+\/spend$/,
]
/** What a write with no rule is called in its can't-undo row. */
const NAMES: [RegExp, string][] = [
  [/\/jobs\/sync$/, "Sync"],
  [/\/data\/summaries$/, "Summary run"],
  [/\/attempts\//, "Summary attempt"],
  [/\/publication|\/telegram\/publish/, "Publish"],
  [/\/data\/chat-sessions$/, "Chat"],
  [/\/data\/tag-runs$/, "Tag run"],
  [/\/data\/discover\/reports$/, "Discover report"],
  [/\/discover\/reports\/[^/]+$/, "Deleted a Discover report"],
  [/\/bulk-reset-sync$/, "Reset sync"],
  [/\/directory\//, "Directory operation"],
  [/\/probe\//, "Probe"],
]

function readBody(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === "string") return Promise.resolve(init.body)
  if (input instanceof Request) return input.clone().text()
  return Promise.resolve("")
}

/** Wraps `fetch` once; it records only while F listens. */
export function installServerUndo() {
  if ((globalThis.fetch as { proto?: boolean }).proto) return
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase()
    if (!listener || quiet > 0 || Date.now() < quietUntil || method === "GET")
      return original(input, init)
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    )
    const path = url.pathname
    const rule = RULES.find((r) => r.method === method && r.re.test(path))
    if (!rule && SILENT.some((re) => re.test(path)))
      return original(input, init)
    const text = await readBody(input, init)
    let body: unknown
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = undefined
    }
    const m = rule ? (path.match(rule.re) as RegExpMatchArray) : null
    let before: unknown
    try {
      before = rule?.before && m ? await rule.before(m, body) : undefined
    } catch {
      before = undefined
    }
    const res = await original(input, init)
    if (res.ok && listener) {
      const out = await res
        .clone()
        .json()
        .catch(() => null)
      const action = rule
        ? rule.make({ path, m: m as RegExpMatchArray, body, before, out })
        : {
            label:
              NAMES.find(([re]) => re.test(path))?.[1] ??
              `${method} ${path.replace("/api/v1/", "")}`,
            undo: null,
            redo: [],
          }
      if (action) listener(action)
    }
    return res
  }
  globalThis.fetch = Object.assign(wrapped, { proto: true }) as typeof fetch
  // For checking the rules from the console: a write sent by hand leaves the cache stale.
  Object.assign(window, { protoQueryClient: queryClient })
}
