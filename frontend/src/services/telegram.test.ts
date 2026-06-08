import { describe, expect, it, vi, beforeEach } from "vitest";
import { publishSummary } from "./telegram";
import { api } from "@/api";

vi.mock("@/api", () => ({
  api: {
    publish: vi.fn(),
  },
}));

vi.mock("../lib/repository", () => ({
  saveNetworkLog: vi.fn().mockResolvedValue(undefined),
}));

describe("publishSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success when all Telegram results are ok", async () => {
    vi.mocked(api.publish).mockResolvedValue({
      success: true,
      results: [{ ok: true, result: { message_id: 1 } }],
    });

    const result = await publishSummary("cred-1", "-100", "hello");
    expect(result.success).toBe(true);
    expect(result.responses).toHaveLength(1);
  });

  it("returns failure when Telegram result has ok=false", async () => {
    vi.mocked(api.publish).mockResolvedValue({
      success: true,
      results: [{ ok: false, description: "Forbidden" }],
    });

    const result = await publishSummary("cred-1", "-100", "hello");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Forbidden");
  });

  it("returns failure when API reports success=false", async () => {
    vi.mocked(api.publish).mockResolvedValue({
      success: false,
      results: [],
      error: "Server rejected publish",
    });

    const result = await publishSummary("cred-1", "-100", "hello");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Server rejected publish");
  });
});
