import { Awaitable } from "./types";

type ByAttemptTimes<T> = (attemptedTimes: number) => T;
type MaybeByAttemptTimes<T> = T | ByAttemptTimes<T>;

const maybeByAttemptTimes = <T>(
  v: MaybeByAttemptTimes<T>,
  attemptedTimes: number,
) =>
  typeof v === "function"
    ? (v as (attemptedTimes: number) => T)(attemptedTimes)
    : v;

export interface RetryOptions<T> {
  signal?: AbortSignal;
  /**
   * predicate if the return value is success
   */
  predicate?: (value: Awaited<T>) => Awaitable<boolean>;
  /**
   * max attempt times
   * @default {5}
   */
  maxTries?: number;
  /**
   * delay time before next attempt
   * @default {0}
   */
  delay?: MaybeByAttemptTimes<number>;
  /**
   * timeout per attempt in ms (NOT for the entire retry)
   * @default {60_000}
   */
  timeout?: MaybeByAttemptTimes<number>;
  /**
   * this will run as microtask (so running this callback does not affect retry time)
   */
  onAttemptFailed?(error: unknown, attemptedTimes: number): void;
}

export class RetryError extends Error {
  constructor(
    message?: // retry error
    | "MAX_RETRIES_REACHED"
      | "RETRY_IS_ABORTED"
      // attempt error
      | "ATTEMPT_PREDICATE_FAILED"
      | "ATTEMPT_TIMEOUT_REACHED",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export async function retry<T>(
  fn: () => Awaitable<T>,
  options: RetryOptions<T> = {},
): Promise<T> {
  const maxTries = options?.maxTries || 5;
  let attemptedTimes = 0;
  let timeoutID: ReturnType<typeof setTimeout> | undefined;

  const work = async (): Promise<T> => {
    if (++attemptedTimes > maxTries)
      throw new RetryError("MAX_RETRIES_REACHED");

    try {
      // wait time in ms
      const timeout = maybeByAttemptTimes(
        options.timeout ?? 60_000,
        attemptedTimes,
      );

      const timeoutSymbol = Symbol("timeoutSymbol");
      const timeoutPromise = new Promise<typeof timeoutSymbol>((resolve) => {
        clearTimeout(timeoutID);
        timeoutID = setTimeout(() => resolve(timeoutSymbol), timeout);
      });

      // attempt once, but have timeout
      const value = await Promise.race([timeoutPromise, fn()]);

      if (value === timeoutSymbol)
        throw new RetryError("ATTEMPT_TIMEOUT_REACHED");

      if (
        typeof options.predicate === "function" &&
        !(await options.predicate(value))
      )
        throw new RetryError("ATTEMPT_PREDICATE_FAILED");

      // success
      return value;
    } catch (error) {
      // run the callback in the background
      queueMicrotask(() => options.onAttemptFailed?.(error, attemptedTimes));
    }

    // delay for a while before starting next attempt
    const delay = maybeByAttemptTimes(options.delay || 0, attemptedTimes);
    if (delay > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, delay));

    // do next attempt
    return new Promise<T>((resolve, reject) => {
      // we must run this as macro task
      // allowing run other micro task first
      setTimeout(() => {
        work().then(resolve, reject);
      }, 0);
    });
  };

  const abortSymbol = Symbol("abortSymbol");
  const abortPromise = new Promise<typeof abortSymbol>((resolve) =>
    options.signal?.addEventListener("abort", () => resolve(abortSymbol)),
  );

  const result = await Promise.race([abortPromise, work()]);
  if (result === abortSymbol) throw new RetryError("RETRY_IS_ABORTED");
  return result;
}
