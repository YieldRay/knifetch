import { describe, expect, it, vi } from "vitest";
import { retry, RetryError } from "../src/retry";

describe("retry", () => {
  it("should succeed without retries", async () => {
    const mockFn = vi.fn().mockResolvedValue("success");

    const result = await retry(mockFn);
    expect(result).toBe("success");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("should retry and succeed", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("success");

    const result = await retry(mockFn, { maxTries: 3 });
    expect(result).toBe("success");
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it("should fail after max retries", async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(
      retry(mockFn, { maxTries: 3, timeout: 100 }),
    ).rejects.toThrowError(new RetryError("MAX_RETRIES_REACHED"));
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it("should handle timeout per attempt", async () => {
    const mockFn = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
      );

    const onAttemptFailed = vi.fn().mockImplementation((error) => {
      expect(error).toStrictEqual(new RetryError("ATTEMPT_TIMEOUT_REACHED"));
    });

    await expect(
      retry(mockFn, { timeout: 100, maxTries: 3, onAttemptFailed }),
    ).rejects.toThrowError(new RetryError("MAX_RETRIES_REACHED"));

    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it("should retry on predicate failure", async () => {
    const mockFn = vi.fn().mockResolvedValue("resolved");
    const predicate = vi.fn().mockResolvedValue(false);

    const onAttemptFailed = vi.fn().mockImplementation((error) => {
      expect(error).toStrictEqual(new RetryError("ATTEMPT_PREDICATE_FAILED"));
    });

    await expect(
      retry(mockFn, { predicate, maxTries: 2, onAttemptFailed }),
    ).rejects.toThrowError(new RetryError("MAX_RETRIES_REACHED"));

    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(predicate).toHaveBeenCalledTimes(2);
  });

  it("should respect delay between retries", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("success");

    const delay = 100;
    const start = Date.now();
    const result = await retry(mockFn, { maxTries: 2, delay });

    const end = Date.now();
    expect(result).toBe("success");
    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(end - start).toBeGreaterThanOrEqual(delay);
  });

  it("should abort retries", async () => {
    await expect(
      retry(() => Promise.reject(false), {
        signal: AbortSignal.timeout(1000),
        maxTries: Infinity,
      }),
    ).rejects.toThrowError(new RetryError("RETRY_IS_ABORTED"));
  });

  it("should call onAttemptFailed callback on failure", async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error("fail"));
    const onAttemptFailed = vi.fn();

    await expect(
      retry(mockFn, { maxTries: 2, onAttemptFailed }),
    ).rejects.toThrowError(new RetryError("MAX_RETRIES_REACHED"));

    expect(onAttemptFailed).toHaveBeenCalledTimes(2);
    expect(onAttemptFailed).toHaveBeenCalledWith(expect.any(Error), 1);
  });
});
