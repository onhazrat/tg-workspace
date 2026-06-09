import { describe, it, expect } from "vitest";

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys";

describe("useChannels query config", () => {
  it("uses stable channels query key", () => {
    expect(queryKeys.channels).toEqual(["channels"]);
  });

  it("uses 30s stale time constant for summarizer reads", () => {
    expect(SUMMARIZER_STALE_TIME).toBe(30_000);
  });
});
