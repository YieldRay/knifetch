import { afterEach, describe, expect, it, vi } from "vitest";
import { AbortError, retry, TimeoutError } from "../src/retry";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Deterministic backoff: kill jitter so delays are predictable in tests.
const noJitter = { jitter: false, minTimeout: 0 } as const;

describe("retry", () => {
  it("resolves on the first successful attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    await expect(retry(fn, noJitter)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes the 1-based attempt number to fn", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce("ok");

    await retry(fn, noJitter);
    expect(fn).toHaveBeenNthCalledWith(1, 1);
    expect(fn).toHaveBeenNthCalledWith(2, 2);
  });

  it("retries then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("recovered");

    await expect(retry(fn, { retries: 3, ...noJitter })).resolves.toBe(
      "recovered",
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows the LAST underlying error after exhausting retries", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValue(new Error("final"));

    await expect(retry(fn, { retries: 2, ...noJitter })).rejects.toThrowError(
      "final",
    );
    // retries: 2 => 3 total attempts
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries: 0 disables retrying (single attempt)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(retry(fn, { retries: 0 })).rejects.toThrowError("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  describe("shouldRetry", () => {
    it("stops immediately when predicate returns false", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("nope"));
      const shouldRetry = vi.fn().mockReturnValue(false);

      await expect(
        retry(fn, { retries: 5, shouldRetry, ...noJitter }),
      ).rejects.toThrowError("nope");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledTimes(1);
    });

    it("receives error, attempt, and retriesLeft context", async () => {
      const err = new Error("boom");
      const fn = vi.fn().mockRejectedValue(err);
      const shouldRetry = vi.fn().mockReturnValue(true);

      await expect(
        retry(fn, { retries: 2, shouldRetry, ...noJitter }),
      ).rejects.toBe(err);

      expect(shouldRetry).toHaveBeenNthCalledWith(1, {
        error: err,
        attempt: 1,
        retriesLeft: 2,
      });
      expect(shouldRetry).toHaveBeenNthCalledWith(2, {
        error: err,
        attempt: 2,
        retriesLeft: 1,
      });
    });
  });

  describe("onFailedAttempt", () => {
    it("is called once per failure (not on ultimate success)", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("1"))
        .mockRejectedValueOnce(new Error("2"))
        .mockResolvedValueOnce("ok");
      const onFailedAttempt = vi.fn();

      await retry(fn, { retries: 5, onFailedAttempt, ...noJitter });
      expect(onFailedAttempt).toHaveBeenCalledTimes(2);
    });

    it("aborts the loop when it throws", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("boom"));
      const onFailedAttempt = vi.fn().mockImplementation(() => {
        throw new Error("stop from hook");
      });

      await expect(
        retry(fn, { retries: 5, onFailedAttempt, ...noJitter }),
      ).rejects.toThrowError("stop from hook");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("AbortError", () => {
    it("stops retrying when fn throws an AbortError", async () => {
      const fn = vi.fn().mockRejectedValue(new AbortError());

      await expect(retry(fn, { retries: 5, ...noJitter })).rejects.toThrowError(
        AbortError,
      );
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("rethrows the wrapped cause when AbortError has one", async () => {
      const cause = new Error("real reason");
      const fn = vi.fn().mockRejectedValue(new AbortError("wrap", { cause }));

      await expect(retry(fn, { retries: 5, ...noJitter })).rejects.toBe(cause);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("timeout", () => {
    it("fails an attempt that exceeds the timeout", async () => {
      const fn = vi
        .fn()
        .mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(resolve, 1000)),
        )
        .mockResolvedValueOnce("ok");

      const onFailedAttempt = vi.fn();
      await expect(
        retry(fn, { retries: 1, timeout: 20, onFailedAttempt, ...noJitter }),
      ).resolves.toBe("ok");

      expect(onFailedAttempt).toHaveBeenCalledTimes(1);
      expect(onFailedAttempt.mock.calls[0][0].error).toBeInstanceOf(
        TimeoutError,
      );
    });

    it("treats timeout of 0 or Infinity as disabled", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(retry(fn, { timeout: 0, ...noJitter })).resolves.toBe("ok");
      await expect(
        retry(fn, { timeout: Number.POSITIVE_INFINITY, ...noJitter }),
      ).resolves.toBe("ok");
    });

    it("does not leave a pending timer on success (no open handles)", async () => {
      // If the timeout timer were not cleared, this test would keep a 10s
      // handle alive. Vitest's fake timers assert nothing remains pending.
      vi.useFakeTimers();
      const fn = vi.fn().mockResolvedValue("ok");

      const promise = retry(fn, { timeout: 10_000, ...noJitter });
      await expect(promise).resolves.toBe("ok");

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("signal abort", () => {
    it("rejects immediately if the signal is already aborted", async () => {
      const fn = vi.fn();
      const controller = new AbortController();
      controller.abort(new Error("already"));

      await expect(
        retry(fn, { signal: controller.signal, ...noJitter }),
      ).rejects.toThrowError("already");
      expect(fn).not.toHaveBeenCalled();
    });

    it("stops the loop and does not schedule more attempts after abort", async () => {
      const controller = new AbortController();
      const fn = vi.fn().mockImplementation(() => {
        // abort while an attempt is in flight
        controller.abort(new Error("cancelled"));
        return Promise.reject(new Error("fail"));
      });

      await expect(
        retry(fn, {
          retries: Number.POSITIVE_INFINITY,
          signal: controller.signal,
          minTimeout: 5,
          jitter: false,
        }),
      ).rejects.toThrowError("cancelled");

      // Only the in-flight attempt ran; no runaway loop.
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("aborts an in-flight attempt via signal while a timeout is configured", async () => {
      // Exercises the signal branch inside withTimeout (reject on abort rather
      // than on the timeout timer).
      const controller = new AbortController();
      const fn = vi.fn(
        () =>
          new Promise((resolve) => {
            // resolves far later than we abort, but before the 10s timeout
            setTimeout(resolve, 5000);
          }),
      );

      const promise = retry(fn, {
        retries: 0,
        timeout: 10_000,
        signal: controller.signal,
      });
      await Promise.resolve();
      controller.abort(new Error("cancelled in flight"));

      await expect(promise).rejects.toThrowError("cancelled in flight");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("interrupts the backoff delay when aborted mid-wait", async () => {
      const controller = new AbortController();
      const fn = vi.fn().mockRejectedValue(new Error("fail"));

      const promise = retry(fn, {
        retries: 5,
        minTimeout: 10_000,
        maxTimeout: 10_000,
        jitter: false,
        signal: controller.signal,
      });

      // Let the first attempt fail and fully enter the long backoff delay
      // (several microtasks: catch -> shouldRetry -> onFailedAttempt -> delay),
      // then abort so the delay's own abort listener fires.
      await new Promise((r) => setTimeout(r, 10));
      controller.abort(new Error("cancelled during delay"));

      await expect(promise).rejects.toThrowError("cancelled during delay");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("calculateDelay", () => {
    it("overrides the built-in backoff with the returned value", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      const calculateDelay = vi.fn().mockReturnValue(0);

      await expect(
        retry(fn, {
          retries: 2,
          minTimeout: 10_000,
          maxTimeout: 10_000,
          jitter: false,
          calculateDelay,
        }),
      ).rejects.toThrowError("fail");

      // if the 10s backoff had applied, this test would time out
      expect(fn).toHaveBeenCalledTimes(3);
      expect(calculateDelay).toHaveBeenCalledTimes(2);
      expect(calculateDelay).toHaveBeenNthCalledWith(1, {
        error: expect.any(Error),
        attempt: 1,
        retriesLeft: 2,
      });
    });

    it("falls back to backoff when it returns a negative/non-finite value", async () => {
      const timestamps: number[] = [];
      const start = Date.now();
      const fn = vi.fn().mockImplementation(() => {
        timestamps.push(Date.now() - start);
        return Promise.reject(new Error("fail"));
      });
      // NaN and -1 both force fallback to the built-in backoff
      const calculateDelay = vi
        .fn()
        .mockReturnValueOnce(Number.NaN)
        .mockReturnValueOnce(-1);

      await expect(
        retry(fn, {
          retries: 2,
          minTimeout: 30,
          maxTimeout: 1000,
          factor: 2,
          jitter: false,
          calculateDelay,
        }),
      ).rejects.toThrowError("fail");

      expect(fn).toHaveBeenCalledTimes(3);
      expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(25);
    });
  });

  describe("backoff", () => {
    it("applies exponential delays without jitter", async () => {
      const timestamps: number[] = [];
      const start = Date.now();
      const fn = vi.fn().mockImplementation(() => {
        timestamps.push(Date.now() - start);
        return Promise.reject(new Error("fail"));
      });

      await expect(
        retry(fn, {
          retries: 2,
          factor: 2,
          minTimeout: 40,
          maxTimeout: 1000,
          jitter: false,
        }),
      ).rejects.toThrowError("fail");

      expect(fn).toHaveBeenCalledTimes(3);
      // gaps should be ~40ms then ~80ms
      const gap1 = timestamps[1] - timestamps[0];
      const gap2 = timestamps[2] - timestamps[1];
      expect(gap1).toBeGreaterThanOrEqual(35);
      expect(gap2).toBeGreaterThanOrEqual(gap1);
    });
  });
});
