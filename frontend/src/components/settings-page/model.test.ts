/**
 * How the Settings page reads a search (SET-02). The Playwright spec drives
 * these through the page; the CRAP ratchet only sees unit coverage, so the
 * rules are pinned here too.
 */
import { describe, expect, test } from "bun:test"
import { type Filters, filterRows, parseQuery, type Row } from "./model"

const row = (over: Partial<Row>): Row =>
  ({
    id: "sync.yours.interval",
    title: "Sync interval",
    description: "Minutes between syncs.",
    topic: "sync",
    scope: "account",
    type: "integer",
    value: 60,
    default: 60,
    defaultSource: "code",
    modified: false,
    canEdit: true,
    lockReason: null,
    applies: "now",
    storage: "tg_user_settings.sync.interval",
    sensitive: false,
    ...over,
  }) as Row

const ALL: Filters = { scope: "all", modifiedOnly: false, editableOnly: false }

describe("parseQuery", () => {
  test("splits words from operators", () => {
    expect(
      parseQuery(
        "  Proxy @modified @editable @restart @id:network. @scope:yours  ",
      ),
    ).toEqual({
      text: ["proxy"],
      filters: {
        modifiedOnly: true,
        editableOnly: true,
        restart: true,
        idPrefix: "network.",
        scope: "account",
      },
    })
  })

  test("a scope reads by segment or id; an unknown one is ignored", () => {
    expect(parseQuery("@scope:deployment").filters.scope).toBe("deployment")
    expect(parseQuery("@scope:account").filters.scope).toBe("account")
    expect(parseQuery("@scope:nowhere").filters.scope).toBeUndefined()
  })
})

describe("filterRows", () => {
  const rows = [
    row({}),
    row({
      id: "network.deployment.proxy",
      title: "Use proxies",
      description: "Send sync traffic through the pool.",
      scope: "deployment",
      modified: true,
      canEdit: false,
      applies: "restart",
    }),
    row({
      id: "server.env.port",
      title: "Port",
      description: "",
      scope: "env",
      envName: "PORT",
      value: 8000,
    }),
  ]
  const ids = (q: string, f: Filters = ALL) =>
    filterRows(rows, q, f).map((r) => r.id)

  test("every word must match the id, title, description, env name or value", () => {
    expect(ids("port")).toEqual(["server.env.port"])
    expect(ids("8000")).toEqual(["server.env.port"])
    expect(ids("sync minutes")).toEqual(["sync.yours.interval"])
    expect(ids("zebra")).toEqual([])
  })

  test("a title or id match ranks above a description match", () => {
    expect(ids("sync")).toEqual([
      "sync.yours.interval",
      "network.deployment.proxy",
    ])
  })

  test("pills and operators narrow by scope, change, edit and restart", () => {
    expect(ids("", { ...ALL, scope: "env" })).toEqual(["server.env.port"])
    expect(ids("@modified")).toEqual(["network.deployment.proxy"])
    expect(ids("", { ...ALL, editableOnly: true })).toEqual([
      "sync.yours.interval",
      "server.env.port",
    ])
    expect(ids("@restart")).toEqual(["network.deployment.proxy"])
    expect(ids("@id:server.")).toEqual(["server.env.port"])
  })
})
