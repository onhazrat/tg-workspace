/**
 * PROTOTYPE, throw away. Client for the summary-attempts prototype API
 * (`backend/scripts/proto_summary_attempts_api.py`, behind Vite's `/proto`).
 *
 * Attempts are their own entity, not LLM logs: logs are pruned for space, and
 * pruning must not erase a Summary's history.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { headers } from "@/api/base"

export type ErrorKind =
  | "quota"
  | "auth"
  | "transient"
  | "model"
  | "limit"
  | "empty"
  | "other"

export type ServerAttempt = {
  id: string
  summaryId: string
  attempt: number
  outcome: "failed" | "succeeded" | "kept_draft"
  kind: ErrorKind | null
  error: string | null
  model: string
  keyId: string | null
  partialText: string | null
  auto: boolean
  at: number
}

export type NewAttempt = Omit<
  ServerAttempt,
  "id" | "summaryId" | "attempt" | "at"
>

/** What kind of failure an error message is; decides whether to auto-retry. */
export function classifyError(error: string): ErrorKind {
  const e = error.toLowerCase()
  if (/token limit|a single prompt/.test(e)) return "limit"
  if (/429|quota|resource_exhausted/.test(e)) return "quota"
  if (/401|403|api key|unauthori[sz]ed|forbidden/.test(e)) return "auth"
  if (/404|model not found|no such model|not a valid model/.test(e))
    return "model"
  if (/empty response/.test(e)) return "empty"
  if (
    /timed? ?out|5\d\d|unavailable|overloaded|reset|ended early|network/.test(e)
  )
    return "transient"
  return "other"
}

/** Seconds a provider asked us to wait, when the message says. */
export function retryAfterSeconds(error: string): number | null {
  const m = /retry[- ]after:? (\d+)/i.exec(error)
  return m ? Number(m[1]) : null
}

async function protoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/proto${path}`, { ...init, headers: headers() })
  if (!r.ok) throw new Error(`prototype API ${r.status}`)
  return r.json() as Promise<T>
}

export const attemptsKey = (id: string) => ["proto-attempts", id] as const
export const failedKey = ["proto-failed"] as const

export function useAttempts(summaryId: string) {
  return useQuery({
    queryKey: attemptsKey(summaryId),
    queryFn: () =>
      protoFetch<ServerAttempt[]>(`/summaries/${summaryId}/attempts`),
  })
}

/** Summaries whose latest attempt failed: the `failed` status, derived. */
export function useFailedSummaries(enabled = true) {
  return useQuery({
    enabled,
    retry: false,
    queryKey: failedKey,
    queryFn: () =>
      protoFetch<{ summaryId: string; attempts: number; kind: string }[]>(
        "/failed",
      ),
    staleTime: 10_000,
  })
}

export async function postAttempt(summaryId: string, a: NewAttempt) {
  return protoFetch<ServerAttempt>(`/summaries/${summaryId}/attempts`, {
    method: "POST",
    body: JSON.stringify(a),
  })
}

export function useAddAttempt(summaryId: string) {
  const qc = useQueryClient()
  return async (a: NewAttempt) => {
    const row = await postAttempt(summaryId, a)
    await qc.invalidateQueries({ queryKey: attemptsKey(summaryId) })
    await qc.invalidateQueries({ queryKey: failedKey })
    return row
  }
}

/** Made-up report text for a stubbed stream that dies part-way. */
const SAMPLE_DRAFT = `This briefing covers the window's most reported developments across the selected channels.

## Executive Summary

Shipping through the strait slowed for a third day as insurers raised war-risk premiums, and two carriers rerouted around the cape. Regional channels reported a new round of talks, though official outlets have not confirmed a date.

## Security

- **Port strikes:** Several channels reported strikes near the northern port; casualty figures differ widely between sources.
- **Air defence:** Interceptions were claimed over two cities overnight. State-affiliated media`

/** The attempt a stubbed run records, by the outcome chosen in the bar. */
export function stubAttempt(
  outcome: "quota" | "timeout" | "cut" | "succeed",
  model: string,
  keyId: string | null,
  auto: boolean,
): NewAttempt {
  const base = { model, keyId, auto, partialText: null }
  if (outcome === "succeed")
    return { ...base, outcome: "succeeded", kind: null, error: null }
  if (outcome === "quota")
    return {
      ...base,
      outcome: "failed",
      kind: "quota",
      error:
        "The AI provider failed: 429 RESOURCE_EXHAUSTED. You exceeded your current quota, please check your plan and billing details.",
    }
  if (outcome === "timeout")
    return {
      ...base,
      outcome: "failed",
      kind: "transient",
      error:
        "The AI provider failed: 503 Service Unavailable. The model is overloaded. Retry after 8 seconds.",
    }
  return {
    ...base,
    outcome: "failed",
    kind: "transient",
    error: "The stream ended early: connection reset by peer.",
    partialText: SAMPLE_DRAFT,
  }
}
