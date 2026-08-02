import { CookieJar } from "./cookiejar";
import isNetworkError, { HttpError } from "./error";
import {
  type FailedAttempt,
  retry as withRetry,
  type RetryOptions,
} from "./retry";
import type { Awaitable, Nullable } from "./types";

export type Fetch = typeof fetch;

/**
 * Represents a value that can be converted to a string.
 */
type TString = string | number;

/**
 * HTTP methods that are considered idempotent and therefore safe to retry by
 * default. Retrying a non-idempotent request (e.g. POST/PATCH) may cause
 * duplicate side effects, so those are excluded unless opted in via `methods`.
 */
const DEFAULT_RETRY_METHODS = [
  "GET",
  "HEAD",
  "PUT",
  "DELETE",
  "OPTIONS",
  "TRACE",
];

/**
 * Response status codes that are retried by default. Mirrors the sets used by
 * `got`/`ky`: request timeout, conflict, too-early, too-many-requests, and the
 * common transient 5xx codes.
 */
const DEFAULT_RETRY_STATUS_CODES = [408, 409, 425, 429, 500, 502, 503, 504];

/**
 * Retry configuration for HTTP requests. Extends the generic
 * {@link RetryOptions} with fetch-specific filtering.
 */
export interface FetchRetryOptions extends Omit<RetryOptions, "signal"> {
  /**
   * HTTP methods that are eligible for retrying.
   * @default ["GET", "HEAD", "PUT", "DELETE", "OPTIONS", "TRACE"]
   */
  methods?: string[];

  /**
   * Response status codes that trigger a retry (when the method is eligible).
   * @default [408, 409, 425, 429, 500, 502, 503, 504]
   */
  statusCodes?: number[];
}

/**
 * Parses a `Retry-After` header value into milliseconds.
 * Supports both delay-seconds and an HTTP-date. Returns `undefined` when the
 * header is absent or unparseable.
 */
function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;

  // delay-seconds
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  // HTTP-date
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return undefined;
}

/**
 * Extended RequestInit interface with additional request configuration options.
 */
export interface KRequestInit extends RequestInit {
  /**
   * Query parameters to append to the URL.
   * Null and undefined values are ignored.
   */
  query?: Record<string, Nullable<TString>>;

  /**
   * JSON payload for the request body.
   * Sets Content-Type to 'application/json'.
   * Intended for objects and arrays only.
   */
  json?: Record<PropertyKey, unknown> | Array<unknown>;

  /**
   * FormData payload for the request body.
   * Sets Content-Type to 'multipart/form-data'.
   * Null and undefined values are ignored when using object format.
   */
  formData?: FormData | Record<string, Nullable<TString | Blob>>;

  /**
   * URLSearchParams payload for the request body.
   * Sets Content-Type to 'application/x-www-form-urlencoded'.
   * Null and undefined values are ignored when using object format.
   */
  form?: URLSearchParams | Record<string, Nullable<TString>>;

  /**
   * Retry configuration for failed requests.
   *
   * By default only idempotent methods and transient status codes are retried,
   * and the `Retry-After` header is honored.
   *
   * - `true` enables retrying with default options.
   * - A number sets the maximum number of retries.
   * - An object is merged with the defaults as {@link FetchRetryOptions}.
   */
  retry?: boolean | number | FetchRetryOptions;
}

/**
 * Configuration options for creating a Knifetch instance.
 */
export interface KnifetchOptions<T> {
  /**
   * Custom fetch implementation. Defaults to globalThis.fetch.
   */
  fetch?: Fetch;

  /**
   * Base URL prefix for all requests.
   * Only applies when request URL is provided as a string.
   */
  baseURL?: string;

  /**
   * Cookie jar instance or boolean to enable cookie management.
   */
  cookieJar?: boolean | CookieJar;

  /**
   * When `true` (the default), responses with a non-2xx status reject with an
   * {@link HttpError}. This is what enables status-code-based retrying.
   * Set to `false` to always resolve with the raw {@link Response}.
   * @default true
   */
  throwHttpErrors?: boolean;

  /**
   * Pre-request interceptor function.
   */
  onRequest?({ request }: { request: Request }): Awaitable<Request | void>;

  /**
   * Post-response interceptor function.
   */
  onResponse?({
    request,
    response,
  }: {
    request: Request;
    response: Response;
  }): Awaitable<Response | void>;

  /**
   * Error handler for failed fetch requests.
   * Returning a Response will trigger onResponse interceptor.
   */
  onFetchError?({
    request,
    error,
  }: {
    request: Request;
    error: unknown;
  }): Awaitable<Response | void>;

  /**
   * Response transformation function.
   */
  transformResponse?(response: Response): Awaitable<T>;
}

/**
 * Creates a customized fetch function with enhanced features and middleware support.
 * @param options - Configuration options for the fetch instance
 * @returns Enhanced fetch function
 */
export function createKnifetch<T = Response>(options?: KnifetchOptions<T>) {
  const fetch = options?.fetch || globalThis.fetch;
  const cookieJar =
    options?.cookieJar &&
    (options.cookieJar === true ? new CookieJar() : options.cookieJar);

  return async (
    rInput: RequestInfo | URL,
    rInit: KRequestInit = {},
  ): Promise<T> => {
    let input: RequestInfo | URL = rInput;
    if (options?.baseURL && typeof rInput === "string") {
      input = `${options.baseURL}${rInput}`;
    }

    const { query, json, formData, form, retry, ...init } = rInit;
    const headers = new Headers(init.headers);

    // Default the method to POST when a body helper is used. An explicit
    // `init.body` is left untouched (both method and serialization).
    if (!init.method && (json || form || formData)) {
      init.method = "POST";
    }

    // Serialize a body helper only when no explicit `body` was provided.
    if (!("body" in init)) {
      let contentType: string | undefined;
      if (json) {
        contentType = "application/json";
        init.body = JSON.stringify(json);
      } else if (form) {
        contentType = "application/x-www-form-urlencoded";
        if (form instanceof URLSearchParams) {
          init.body = form;
        } else {
          const params = new URLSearchParams();
          for (const [name, value] of Object.entries(form)) {
            // ignore `undefined` and `null`
            if (value == undefined) continue;
            params.set(
              name,
              // the constructor actually convert the value to string
              // so we accept TString as string
              value as string,
            );
          }
          init.body = params;
        }
      } else if (formData) {
        // fetch will set content-type to multipart/form-data
        if (formData instanceof FormData) {
          init.body = formData;
        } else {
          const fd = new FormData();
          for (const [name, value] of Object.entries(formData)) {
            // ignore `undefined` and `null`
            if (value == undefined) continue;
            fd.set(
              name,
              // the constructor actually convert the value to string
              value as string | Blob,
            );
          }
          init.body = fd;
        }
      }
      if (contentType && !headers.has("content-type")) {
        headers.set("content-type", contentType);
      }
    }

    // handle cookies
    if (cookieJar && !headers.has("cookie")) {
      for (const cookie of cookieJar.getCookies(input)) {
        headers.append("cookie", cookie);
      }
    }

    init.headers = headers;

    // create Request object
    let request$: Request;
    if (query) {
      const url = new URL(input instanceof Request ? input.url : input);
      for (const [k, v] of Object.entries(query)) {
        url.searchParams.append(k, String(v));
      }
      request$ = new Request(url, init);
    } else {
      request$ = new Request(input, init);
    }

    const throwHttpErrors = options?.throwHttpErrors !== false;
    const userSignal = init.signal ?? undefined;

    // Per-attempt timeout, in ms. `0`/`Infinity` disables it. When a `retry`
    // object provides a `timeout` we drive it through an AbortSignal so a
    // timed-out attempt actually cancels the in-flight fetch.
    const perAttemptTimeout =
      retry && typeof retry === "object" ? retry.timeout : undefined;

    const action = async (): Promise<T> => {
      // Clone the base request so its body can be re-sent on subsequent
      // attempts (a Request body stream is consumed once per fetch).
      const baseRequest = request$.clone();

      // call onRequest interceptor
      const onRequestResult: Nullable<Request> = await options?.onRequest?.({
        request: baseRequest,
      });
      const request =
        onRequestResult instanceof Request ? onRequestResult : baseRequest;

      // Compose the effective abort signal for this attempt: the user's signal
      // plus an optional per-attempt timeout signal.
      const signals: AbortSignal[] = [];
      if (userSignal) signals.push(userSignal);
      if (perAttemptTimeout && Number.isFinite(perAttemptTimeout)) {
        signals.push(AbortSignal.timeout(perAttemptTimeout));
      }
      const signal =
        signals.length > 0 ? AbortSignal.any(signals) : request.signal;

      let response: Response | void;
      try {
        // make the actual fetch request
        response = await fetch(new Request(request, { signal }));
      } catch (error) {
        // handle fetch errors with onFetchError interceptor
        const onFetchErrorResult: Nullable<Response> =
          await options?.onFetchError?.({ request, error });
        if (onFetchErrorResult instanceof Response) {
          // if onFetchError returns a Response, use it as the final response
          response = onFetchErrorResult;
        } else {
          // otherwise, error is considered not handled, rethrow the error
          throw error;
        }
      }

      // call onResponse interceptor
      const onResponseResult: Nullable<Response> = await options?.onResponse?.({
        request,
        response,
      });
      response =
        onResponseResult instanceof Response ? onResponseResult : response;

      // persist any Set-Cookie headers into the jar for subsequent requests.
      // A Response constructed manually may have an empty `url`; skip those.
      if (cookieJar && response.url) cookieJar.setCookie(response);

      // surface non-2xx responses as errors so they can be retried/handled
      if (throwHttpErrors && !response.ok) {
        throw new HttpError(response);
      }

      // transform the response if needed
      return options?.transformResponse
        ? options.transformResponse(response)
        : (response as T); // if options.transformResponse is not given, T will be Response
    };

    if (!retry) return action();
    return withRetry<T>(
      action,
      buildRetryOptions(retry, init.method, userSignal),
    );
  };
}

/**
 * Builds generic {@link RetryOptions} from the fetch-specific `retry` input,
 * applying HTTP-aware defaults: idempotent-method filtering, retryable status
 * codes, network-error retrying, and `Retry-After` support.
 */
function buildRetryOptions(
  retry: boolean | number | FetchRetryOptions,
  method: string | undefined,
  signal: AbortSignal | undefined,
): RetryOptions {
  let config: FetchRetryOptions = {};
  if (typeof retry === "number") config = { retries: retry };
  else if (typeof retry === "object") config = retry;

  const methods = config.methods ?? DEFAULT_RETRY_METHODS;
  const statusCodes = config.statusCodes ?? DEFAULT_RETRY_STATUS_CODES;
  const methodAllowed = methods.includes((method ?? "GET").toUpperCase());

  // `timeout` is intentionally dropped here: it is enforced per-attempt via an
  // AbortSignal in the fetch pipeline so a timed-out attempt truly cancels the
  // in-flight request, rather than only losing a `Promise.race`.
  const { methods: _m, statusCodes: _s, timeout: _t, ...retryOptions } = config;

  return {
    ...retryOptions,
    signal,
    shouldRetry:
      config.shouldRetry ??
      (({ error }: FailedAttempt) => {
        if (!methodAllowed) return false;
        if (error instanceof HttpError)
          return statusCodes.includes(error.status);
        return error instanceof Error && isNetworkError(error);
      }),
    calculateDelay:
      config.calculateDelay ??
      (({ error }: FailedAttempt) =>
        error instanceof HttpError
          ? (parseRetryAfter(error.response) ?? Number.NaN)
          : Number.NaN),
  };
}

export const knifetch = /*#__PURE__*/ createKnifetch();
