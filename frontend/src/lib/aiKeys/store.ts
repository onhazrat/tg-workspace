import type { AiKeyResponse } from "@/client"
import {
  dataDeleteAiCredential,
  dataListAiCredentials,
  dataUpsertAiCredential,
} from "@/client"

/**
 * Reads and writes for the `AICredential` aggregate (BYOK-01).
 *
 * **On the generated client, not the hand-written one.** `AIKeyResponse` is
 * closed and its useful fields are required, so the generated type is not a
 * downgrade — which is the whole test ADR-006 applies. `client-split.conform.ts`
 * asserts the closedness, so a `ConfigDict(extra="allow")` added server-side
 * breaks the build rather than quietly typing every field as `unknown`.
 *
 * **The secret only ever goes out.** `AiKeyResponse` carries `hasKey` and never
 * the key, the same shape `BotCredentialResponse` uses for its token — so
 * unlike `bots/store.ts` there is no `stripToken` twin here, because there is
 * no field to strip. If one ever appears, the closedness assertion is what says
 * so first.
 */

export type AiKey = AiKeyResponse

export interface AiKeyDraft {
  id: string
  label: string
  provider?: string
  baseUrl?: string | null
  /** Omit to keep the stored secret — that is how a label is edited. */
  key?: string
}

export async function listAiKeys(): Promise<AiKey[]> {
  return dataListAiCredentials()
}

/** Saves a Key and returns it with what the provider check found. */
export async function saveAiKey(
  draft: AiKeyDraft,
): Promise<{ key: AiKey; validated: boolean }> {
  return dataUpsertAiCredential({
    path: { key_id: draft.id },
    body: {
      label: draft.label,
      provider: draft.provider ?? "gemini",
      baseUrl: draft.baseUrl ?? null,
      ...(draft.key ? { key: draft.key } : {}),
    },
  })
}

export async function deleteAiKey(id: string): Promise<void> {
  await dataDeleteAiCredential({ path: { key_id: id } })
}
