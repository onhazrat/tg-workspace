// PROTOTYPE (filter-memory): `bun src/components/filter-memory-prototype/describe-change.check.ts`
import type { Snapshot } from "./store"

// The store reads the variant from the URL at import.
Object.assign(globalThis, { window: { location: { search: "" } } })
const { describeChange } = await import("./store")

const s = (tabs: string[], tab = "posts", url = {}): Snapshot => ({
  tab,
  params: {},
  url: { tab, ...url },
  tabs: tabs.map((kind) => ({ kind }) as NonNullable<Snapshot["tabs"]>[number]),
  selection: [],
  at: 0,
})
const check = (got: string, want: string) => {
  if (got !== want) throw new Error(`got "${got}", want "${want}"`)
}
check(describeChange(s(["tag", "chat"]), s(["chat", "tag"])), "Moved Chat")
check(
  describeChange(s(["tag", "chat", "tools"]), s(["tag", "tools", "chat"])),
  "Moved Tools",
)
check(describeChange(s(["tag"]), s(["tag", "chat"])), "Opened Chat")
check(
  describeChange(s(["tag", "chat"]), s(["tag"], "tag")),
  "Closed Chat · Went to Tag",
)
check(
  describeChange(s(["tag"]), s(["tag"], "posts", { postFilter: "x" })),
  "postFilter: x",
)
console.log("describeChange: ok")
