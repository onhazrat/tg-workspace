import { Check, Copy, Loader2, RefreshCw, Search } from "lucide-react"
import { motion } from "motion/react"
import { useEffect, useMemo, useState } from "react"
import type {
  ConfigurationCatalog,
  ConfigurationEntry,
  ConfigurationLayer,
  ConfigurationLayerId,
} from "@/api"
import { Badge } from "@/components/ui/badge"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import useAuth from "@/hooks/useAuth"
import { useConfigurationCatalog } from "@/hooks/useConfigurationCatalog"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"
import { frontendBuildValue, hasFrontendBuildValue } from "@/lib/env"

const REDACTED = "••••••"

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set"
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

function hydrateFrontend(catalog: ConfigurationCatalog): ConfigurationCatalog {
  return {
    ...catalog,
    layers: catalog.layers.map((layer) => {
      if (layer.id !== "frontend") return layer
      return {
        ...layer,
        entries: layer.entries.map((entry) => {
          const value = frontendBuildValue(entry.key, entry.default_value)
          const configured = hasFrontendBuildValue(entry.key)
          return {
            ...entry,
            value:
              entry.sensitive && value !== null && value !== ""
                ? REDACTED
                : value,
            configured,
            source: configured ? "frontend build environment" : "code default",
          }
        }),
      }
    }),
  }
}

function ConfigRow({ entry }: { entry: ConfigurationEntry }) {
  return (
    <article
      id={`configuration-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
      data-config-id={entry.id}
      className="scroll-mt-24 rounded-sm border border-app-ink/10 bg-app-card p-4 space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-mono text-xs font-bold break-all">{entry.key}</h4>
          <p className="mt-1 text-[10px] opacity-55">{entry.description}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant={entry.configured ? "default" : "secondary"}>
            {entry.configured ? "configured" : "default"}
          </Badge>
          {entry.restart_required ? (
            <Badge variant="secondary">restart/rebuild</Badge>
          ) : null}
          {entry.sensitive ? <Badge variant="secondary">redacted</Badge> : null}
          {entry.editable ? (
            <Badge variant="secondary">runtime editable</Badge>
          ) : null}
        </div>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm bg-app-ink/5 p-3 font-mono text-[11px] leading-relaxed">
        {displayValue(entry.value)}
      </pre>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-wider opacity-50">
        <span>source: {entry.source}</span>
        {entry.owner_id ? <span>owner: {entry.owner_id}</span> : null}
        {entry.default_value !== null && entry.default_value !== undefined ? (
          <span>default: {displayValue(entry.default_value)}</span>
        ) : null}
      </div>
    </article>
  )
}

function LayerSection({ layer }: { layer: ConfigurationLayer }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-app-ink/10 pb-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest">
            {layer.label}
          </h3>
          <p className="mt-1 text-[10px] italic opacity-50">
            {layer.description}
          </p>
        </div>
        <span className="font-mono text-[10px] opacity-45">
          {layer.entries.length} entries
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {layer.entries.map((entry) => (
          <ConfigRow key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  )
}

export function ConfigurationCatalogView({
  focusId,
}: {
  focusId?: string | null
}) {
  const { user } = useAuth()
  const isAdmin = Boolean(user?.is_superuser)
  const { data, isLoading, error, refetch } = useConfigurationCatalog(isAdmin)
  const [query, setQuery] = useState("")
  const [layerFilter, setLayerFilter] = useState<ConfigurationLayerId | "all">(
    "all",
  )
  const [copiedText, copy] = useCopyToClipboard()

  const hydrated = useMemo(() => (data ? hydrateFrontend(data) : null), [data])
  const visibleLayers = useMemo(() => {
    if (!hydrated) return []
    const needle = query.trim().toLowerCase()
    return hydrated.layers
      .filter((layer) => layerFilter === "all" || layer.id === layerFilter)
      .map((layer) => ({
        ...layer,
        entries: layer.entries.filter((entry) => {
          if (!needle) return true
          return [
            entry.key,
            entry.label,
            entry.description,
            entry.source,
            entry.owner_id ?? "",
            entry.sensitive ? "secret sensitive redacted" : "",
            displayValue(entry.value),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        }),
      }))
      .filter((layer) => layer.entries.length > 0)
  }, [hydrated, layerFilter, query])

  useEffect(() => {
    if (!focusId || !hydrated) return
    const id = `configuration-${focusId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
    })
  }, [focusId, hydrated])

  const copyPayload = hydrated ? JSON.stringify(hydrated, null, 2) : ""

  if (!isAdmin) {
    return (
      <p className="text-sm opacity-60">
        The configuration inventory is available to administrators only.
      </p>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 pb-20"
      data-testid="configuration-catalog"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest">
            Configuration Catalog
          </h2>
          <p className="mt-1 text-[10px] italic opacity-50">
            Five layers, effective sources, safe defaults, and redacted secrets.
          </p>
        </div>
        <div className="flex gap-2">
          <TgButton
            type="button"
            variant="secondary"
            size="sm"
            disabled={!hydrated}
            onClick={() => void copy(copyPayload)}
          >
            {copiedText === copyPayload && copyPayload ? (
              <Check size={12} />
            ) : (
              <Copy size={12} />
            )}
            Copy redacted JSON
          </TgButton>
          <TgButton
            type="button"
            variant="secondary"
            size="sm"
            loading={isLoading}
            loadingLabel="Refresh"
            onClick={() => void refetch()}
          >
            <RefreshCw size={12} />
            Refresh
          </TgButton>
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40"
          />
          <TgInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search keys, values, owners, or sources"
            className="pl-9 normal-case tracking-normal"
            aria-label="Search configuration catalog"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              "all",
              "deployment",
              "global",
              "user",
              "specialized",
              "frontend",
            ] as const
          ).map((layer) => (
            <button
              key={layer}
              type="button"
              onClick={() => setLayerFilter(layer)}
              className={`rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-widest ${
                layerFilter === layer
                  ? "border-app-ink bg-app-ink text-app-bg"
                  : "border-app-ink/15 opacity-60 hover:opacity-100"
              }`}
            >
              {layer}
            </button>
          ))}
        </div>
      </div>

      {isLoading && !hydrated ? (
        <div className="flex items-center gap-2 text-xs opacity-60">
          <Loader2 size={14} className="animate-spin" /> Loading configuration…
        </div>
      ) : null}
      {error ? (
        <div className="border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          {error instanceof Error
            ? error.message
            : "Unable to load configuration"}
        </div>
      ) : null}
      {visibleLayers.map((layer) => (
        <LayerSection key={layer.id} layer={layer} />
      ))}
    </motion.div>
  )
}
