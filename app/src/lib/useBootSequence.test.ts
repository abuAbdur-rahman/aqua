import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBootSequence, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./useBootSequence";
import * as api from "./api";

vi.mock("./api", () => ({
  DAEMON_BASE: "http://localhost:61234",
  checkHealth: vi.fn(),
}));

vi.mock("../system/tauri", () => ({
  tauriInvoke: vi.fn().mockResolvedValue("Ubuntu"),
}));

const mockHealth = vi.mocked(api.checkHealth);

describe("useBootSequence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHealth.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reaches success immediately when the first health ping succeeds", async () => {
    mockHealth.mockResolvedValue({ status: "ok", version: "1.0.0" });
    const { result } = renderHook(() => useBootSequence());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("success");
    expect(mockHealth).toHaveBeenCalledTimes(1);
  });

  it("moves checking → starting on first-ping failure, then waiting during the poll loop", async () => {
    let calls = 0;
    mockHealth.mockImplementation(async () => {
      calls += 1;
      if (calls <= 10) throw new Error("down");
      return { status: "ok", version: "1.0.0" };
    });
    const { result } = renderHook(() => useBootSequence());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("starting");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 8);
    });
    expect(result.current.phase).toBe("waiting");
    // daemon comes up → success
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(result.current.phase).toBe("success");
  });

  it("enters failed state after the ~5s poll timeout", async () => {
    mockHealth.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useBootSequence());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
    });
    expect(result.current.phase).toBe("failed");
    expect(result.current.distro).toBe("Ubuntu");
    expect(result.current.healthUrl).toBe("http://localhost:61234/api/health");
  });

  it("retry restarts the sequence from checking", async () => {
    let down = true;
    mockHealth.mockImplementation(async () => {
      if (down) throw new Error("down");
      return { status: "ok", version: "1.0.0" };
    });
    const { result } = renderHook(() => useBootSequence());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
    });
    expect(result.current.phase).toBe("failed");
    down = false;
    act(() => {
      result.current.retry();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("success");
  });
});

