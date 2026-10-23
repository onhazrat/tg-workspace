/**
 * A Channel table row's own Requests (RQS-10): how the sheet asks for them
 * and reads them. Pinned by `records.test.ts`.
 */
import type { ChannelRow } from "./breakdown"

/** Requests the sheet asks for at a time. */
export const RECORDS_PAGE = 200

/** A Channel's row by its handle, an aggregate row by its kind. */
export const rowQuery = (row: Pick<ChannelRow, "key" | "aggregate">) =>
  row.aggregate ? { kind: row.key } : { channel: row.key }

/** The server's naive UTC instant, to the second. */
export const atText = (at: string) => at.slice(0, 19).replace("T", " ")

const CAUSE_TEXT: Record<string, string> = {
  turnedAway: "Turned away",
  softBlock: "Soft block",
  answeredError: "Answered error",
  transportFault: "Transport fault",
  missingHandle: "Missing handle",
}

/** Why a Wasted Request was wasted, in words. */
export const causeText = (cause: string | null) =>
  cause === null ? "" : (CAUSE_TEXT[cause] ?? cause)
