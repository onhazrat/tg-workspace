/**
 * What `DatabaseManagement` decides, with no React in it: which panels a focus
 * shows, the cached table sizes, what an export asks for, and the toast text.
 * Storage is a parameter so a test can hand in a plain object.
 */
import type {
  TableSizeRow,
  TableSizeSource,
} from "@/components/settings/data/TableSizesPanel"

export type DatabaseFocus =
  | "data"
  | "retention"
  | "table-sizes"
  | "transfer"
  | "query"

export interface PanelVisibility {
  stats: boolean
  retention: boolean
  tables: boolean
  about: boolean
}

const VISIBLE: Record<DatabaseFocus, PanelVisibility> = {
  data: { stats: true, retention: true, tables: true, about: true },
  retention: { stats: false, retention: true, tables: false, about: false },
  "table-sizes": { stats: true, retention: false, tables: true, about: true },
  transfer: { stats: false, retention: false, tables: true, about: false },
  query: { stats: false, retention: false, tables: true, about: false },
}

export function panelVisibility(focus: DatabaseFocus): PanelVisibility {
  return VISIBLE[focus]
}

type SizeStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const sizesKey = (source: TableSizeSource) => `tableSizesCache:${source}`
const calculatedKey = (source: TableSizeSource) =>
  `tableSizesLastCalculated:${source}`

export function readCachedSizes(
  storage: SizeStorage,
  source: TableSizeSource,
): TableSizeRow[] | null {
  const cached = storage.getItem(sizesKey(source))
  if (!cached) return null
  try {
    return JSON.parse(cached)
  } catch (_e) {
    return null
  }
}

export function readCachedLastCalculated(
  storage: SizeStorage,
  source: TableSizeSource,
): number | null {
  const cached = storage.getItem(calculatedKey(source))
  return cached ? Number.parseInt(cached, 10) : null
}

export function writeCachedSizes(
  storage: SizeStorage,
  source: TableSizeSource,
  sizes: TableSizeRow[],
  calculatedAt: number,
): void {
  storage.setItem(sizesKey(source), JSON.stringify(sizes))
  storage.setItem(calculatedKey(source), calculatedAt.toString())
}

/** Every table starts ticked for export. */
export function allTableNames(sizes: TableSizeRow[] | null): Set<string> {
  return new Set(sizes?.map((s) => s.name))
}

/** With no table picked yet, the first one calculated; otherwise none. */
export function tableToSelect(
  sizes: TableSizeRow[],
  current: string,
): string | null {
  return current ? null : (sizes[0]?.name ?? null)
}

export function withTable(
  selected: Set<string>,
  name: string,
  checked: boolean,
): Set<string> {
  const next = new Set(selected)
  if (checked) next.add(name)
  else next.delete(name)
  return next
}

/**
 * The tables an export asks for. The whole selection means "everything", sent
 * as no list at all; `exportDatabaseBlob` treats an empty list the same way.
 */
export function exportSelection(
  tableSizes: TableSizeRow[] | null,
  selected: Set<string>,
): string[] | undefined {
  const allSelected = tableSizes !== null && selected.size === tableSizes.length
  return allSelected ? undefined : Array.from(selected)
}

export function importSummary(imported: Record<string, number>): string {
  const summary = Object.entries(imported)
    .map(([table, count]) => `${table}: ${count}`)
    .join(", ")
  return `Import complete (${summary || "no records"})`
}

export function failureText(prefix: string, err: unknown): string {
  return `${prefix}: ${err instanceof Error ? err.message : String(err)}`
}
