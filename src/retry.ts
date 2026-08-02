import type { Awaitable } from "./types";

/**
 * Context passed to hooks and predicates describing a single failed attempt.
 */
export interface FailedAttempt {
  /**
   * The error thrown by the most recent attempt.
   */
  readonly error: unknown;
  /**
   * The attempt number that just failed, 1-based.
   * The first call to `fn` is attempt `1`.
   */
  readonly attempt: number;
  /**
   * How many retries are left after this failure.
   * When `0`, the error will be rethrown to the caller.
   */
  readonly retriesLeft: number;
}

export interface RetryOptions {
  /**
   * The maximum number of retries *after* the initial attempt.
   * The total number of calls to `fn` is therefore `retries + 1`.
   *
   * Set to `0` to disable retrying.
   * @default 3
   */
  retries?: number;

  /**
   * The exponential backoff factor.
   * The delay before retry `n` (1-based) is
   * `minTimeout * factor ** (n - 1)`, clamped to `maxTimeout`.
   * @default 2
   */
  factor?: number;

  /**
   * The minimum delay between retries, in milliseconds.
   * @default 1000
   */
  minTimeout?: number;

  /**
   * The maximum delay between retries, in milliseconds.
   * @default 30_000
   */
  maxTimeout?: number;

  /**
   * When `true`, applies full jitter: the computed backoff is multiplied by a
   * random value in `[0, 1)`. This spreads out retries to avoid a
   * "thundering herd". Set to `false` for deterministic delays.
   * @default true
   */
  jitter?: boolean;

  /**
   * The timeout for each individual attempt, in milliseconds.
   * If an attempt does not settle within this window it is treated as a
   * failure with a {@link TimeoutError}. Set to `0` or `Infinity` to disable.
   * @default 0 (disabled)
   */
  timeout?: number;

  /**
   * An {@link AbortSignal} used to cancel the whole retry operation.
   * If it is already aborted, `retry` rejects immediately without calling `fn`.
   */
  signal?: AbortSignal;

  /**
   * Decides whether a given error is retryable.
   * Return `false` to stop retrying and rethrow the error immediately.
   * Throwing an {@link AbortError} anywhere also stops retrying.
   * @default () => true
   */
  shouldRetry?(context: FailedAttempt): Awaitable<boolean>;

  /**
   * Called after each failed attempt, before the backoff delay.
   * It is awaited, so it may perform async work (e.g. logging) and may throw
   * to abort the retry loop. Throwing here rethrows that error to the caller.
   */
  onFailedAttempt?(context: FailedAttempt): Awaitable<void>;

  /**
   * Computes the delay (in milliseconds) to wait before the next attempt.
   * When provided, its return value overrides the built-in exponential
   * backoff for that attempt. Useful for honoring server hints such as the
   * `Retry-After` header. Return a negative or non-finite value to fall back
   * to the built-in backoff.
   */
  calculateDelay?(context: FailedAttempt): number;
}

/**
 * Thrown when an individual attempt exceeds the configured `timeout`.
 */
export class TimeoutError extends Error {
  override readonly name = "TimeoutError";

  constructor(timeout: number) {
    super(`Attempt timed out after ${timeout}ms`);
  }
}

/**
 * Throw this (or reject with it) from `fn` to stop retrying immediately.
 * The wrapped `cause`, if any, is what `retry` rejects with; otherwise the
 * `AbortError` itself is thrown.
 */
export class AbortError extends Error {
  override readonly name = "AbortError";

  constructor(message?: string, options?: ErrorOptions) {
    super(message ?? "Retry aborted", options);
  }
}

/**
 * The numeric/behavioral options that always have a concrete value once
 * resolved. `signal` and the callbacks are intentionally excluded because they
 * are genuinely optional and are handled with `?.` at their call sites.
 */
type BackoffConfig = Required<
  Pick<
    RetryOptions,
    "retries" | "factor" | "minTimeout" | "maxTimeout" | "jitter" | "timeout"
  >
>;

const DEFAULTS: BackoffConfig = {
  retries: 3,
  factor: 2,
  minTimeout: 1000,
  maxTimeout: 30_000,
  jitter: true,
  timeout: 0,
};

/**
 * Resolves after `ms`, or rejects if `signal` aborts first. Cleans up its
 * timer/listener on both paths. The caller guarantees `signal` is not already
 * aborted (the retry loop calls `signal.throwIfAborted()` beforehand).
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `fn` once, rejecting with a {@link TimeoutError} if it does not settle
 * within `ms`. The pending timer is always cleared. A `signal` abort also
 * rejects the race so we stop waiting on a runaway attempt.
 */
async function withTimeout<T>(
  fn: () => Awaitable<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  if (!ms || ms === Infinity) return fn();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      if (signal) {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      }
      Promise.resolve(fn()).then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** Computes the backoff delay (ms) before a given 1-based retry number. */
function backoff(retryNumber: number, config: BackoffConfig): number {
  const exp = config.minTimeout * config.factor ** (retryNumber - 1);
  const capped = Math.min(exp, config.maxTimeout);
  return config.jitter ? Math.floor(Math.random() * capped) : capped;
}

/**
 * Retries an async function using exponential backoff with optional jitter.
 *
 * Semantics closely follow well-established libraries such as `p-retry` and
 * `node-retry`:
 * - `retries` counts retries *after* the first attempt.
 * - The original error is rethrown once retries are exhausted (with a `cause`
 *   preserved when the loop is aborted).
 * - Aborting via `signal` or throwing an {@link AbortError} stops immediately;
 *   no further attempts run and no timers are left pending.
 *
 * @example
 * ```ts
 * const data = await retry(() => fetch(url).then((r) => r.json()), {
 *   retries: 5,
 *   shouldRetry: ({ error }) => isNetworkError(error),
 * });
 * ```
 */
export async function retry<T>(
  fn: (attempt: number) => Awaitable<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { signal, shouldRetry, onFailedAttempt, calculateDelay } = options;
  const config: BackoffConfig = { ...DEFAULTS, ...options };
  const maxRetries = Math.max(0, config.retries);

  // Fail fast if we were handed an already-aborted signal.
  signal?.throwIfAborted();

  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(() => fn(attempt), config.timeout, signal);
    } catch (error) {
      // An explicit abort (either the signal firing or an AbortError thrown by
      // `fn`) short-circuits the whole operation.
      signal?.throwIfAborted();
      if (error instanceof AbortError) {
        throw error.cause ?? error;
      }

      const retriesLeft = maxRetries - (attempt - 1);
      const context: FailedAttempt = { error, attempt, retriesLeft };

      // Out of retries, or the predicate rejected this error: give up.
      if (retriesLeft <= 0 || (await shouldRetry?.(context)) === false) {
        throw error;
      }

      // Let the caller observe/log the failure. This is awaited so it can
      // perform async work or throw to abort.
      await onFailedAttempt?.(context);

      // Wait (interruptibly) before the next attempt. A caller-provided
      // `calculateDelay` (e.g. to honor `Retry-After`) overrides the built-in
      // backoff, unless it returns a negative or non-finite value.
      const custom = calculateDelay?.(context);
      const wait =
        custom != undefined && Number.isFinite(custom) && custom >= 0
          ? custom
          : backoff(attempt, config);
      await delay(wait, signal);
    }
  }
}
