import { api } from "@/api"
import { selectedAiKeyId } from "@/lib/aiKeys/selection"
import type { ArtifactListItem } from "@/types"

/**
 * Star, annotate and delete, dispatched by artifact kind.
 *
 * Each kind has its own aggregate and therefore its own write endpoint — there
 * is deliberately no generic `PUT /artifacts/{id}`, because `/data/artifacts`
 * is a **read model**: it owns no table and must never be the thing that writes
 * one. This module is where the unified list turns back into four aggregates.
 *
 * Every write is a partial body. The three upsert endpoints merge into `extra`,
 * so sending `{isStarred}` alone cannot clobber the rest of the row — which is
 * what lets a list item be written back without ever having held the corpus it
 * omits.
 */

export async function setArtifactStarred(
  artifact: ArtifactListItem,
  isStarred: boolean,
): Promise<void> {
  switch (artifact.kind) {
    case "summary":
      await api.upsertSummary(artifact.id, { isStarred })
      return
    case "chat":
      await api.upsertChatSession(artifact.id, { isStarred })
      return
    case "tag":
      await api.upsertTagRun(artifact.id, { isStarred })
      return
    case "discovery":
      await api.updateDiscoverReportFlags(artifact.id, { isStarred })
      return
  }
}

export async function setArtifactNote(
  artifact: ArtifactListItem,
  note: string | null,
): Promise<void> {
  /*
   * `null`, never `undefined`.
   *
   * The upsert endpoints read an explicit null as "remove this key from
   * `extra`" — but `JSON.stringify` drops `undefined` properties entirely, so
   * `note ?? undefined` sent `{}` and clearing a note silently did nothing
   * while the UI toasted "Note deleted." and the note reappeared on refetch.
   */
  const body = { note } as { note: string | null }
  switch (artifact.kind) {
    case "summary":
      await api.upsertSummary(artifact.id, body as never)
      return
    case "chat":
      await api.upsertChatSession(artifact.id, body as never)
      return
    case "tag":
      await api.upsertTagRun(artifact.id, body as never)
      return
    case "discovery":
      await api.updateDiscoverReportFlags(artifact.id, { note })
      return
  }
}

/**
 * The two scheduled-regeneration flags. Summaries only.
 *
 * `autoRegenerate` refuses a scope shorter than a minute, because the job would
 * re-run continuously over a window that barely moves — the same guard the old
 * History card carried.
 *
 * Turning `autoRegenerate` **on** also records which AI Key pays for it
 * (BYOK-03). This is the moment the choice exists to be made: the scheduler
 * fires with nobody present, and browser storage — where the live selection
 * lives — is a per-device convenience the server cannot read.
 *
 * **Enabling always writes the current selection, overwriting any id already
 * stored.** Switching a schedule back on is a fresh decision made with the
 * chooser in front of you, so the Key selected now is the one meant. (An
 * earlier draft of this comment claimed the opposite — that a stored id
 * survived an off-then-on — which the code never did and `ArtifactListItem`
 * could not support anyway, since it does not carry the field.)
 *
 * Turning the flag **off** sends only the flag, so the stored id is left
 * exactly as it was rather than being cleared by a disable.
 *
 * An id naming a Key that has since been deleted is harmless: the server
 * answers it as an absent row and files a failed log row saying so, which is a
 * better outcome than a schedule that silently spends a different credential.
 */
export async function setSummaryFlag(
  artifact: ArtifactListItem,
  flag: "autoRegenerate" | "autoPublish",
  value: boolean,
): Promise<void> {
  if (artifact.kind !== "summary") return
  const body: Record<string, unknown> = { [flag]: value }
  if (flag === "autoRegenerate" && value) {
    body.aiKeyId = selectedAiKeyId() ?? undefined
  }
  await api.upsertSummary(artifact.id, body as never)
}

export async function deleteArtifact(
  artifact: ArtifactListItem,
): Promise<void> {
  switch (artifact.kind) {
    case "summary":
      await api.deleteSummary(artifact.id)
      return
    case "chat":
      await api.deleteChatSession(artifact.id)
      return
    case "tag":
      await api.deleteTagRun(artifact.id)
      return
    case "discovery":
      await api.deleteDiscoverReport(artifact.id)
      return
  }
}
