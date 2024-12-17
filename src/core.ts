import { CookieJar } from "./cookiejar";
import { retry as withRetry, type RetryOptions } from "./retry";
import type { Awaitable, Nullable } from "./types";

export type Fetch = typeof fetch;

/**
 * Represents a value that can be converted to a string.
 */
type TString = string | number;

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
   */
  retry?:
    | boolean
    | number
    | Pick<RetryOptions<unknown>, "delay" | "maxTries" | "timeout">;
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

    const { query, json, formData, form, retry, ...init } = rInit || {};
    const headers = new Headers(init.headers);

    // set default method to POST if a body is provided
    if (!init.method && (json || form || formData)) {
      // note that we do not handle this for init.body
      init.method = "POST";
    }

    // handle different body types
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

    const action = async (): Promise<T> => {
      // call onRequest interceptor
      const request =
        (await options?.onRequest?.({ request: request$ })) || request$;

      let response: Response | void;
      try {
        // make the actual fetch request
        response = await fetch(request);
      } catch (error) {
        // handle fetch errors with onFetchError interceptor
        response = await options?.onFetchError?.({ request, error });
        if (!response) throw error;
      }

      // call onResponse interceptor
      response =
        (await options?.onResponse?.({ request, response })) || response;

      // transform the response if needed
      return options?.transformResponse
        ? options.transformResponse(response)
        : (response as T); // if options.transformResponse is not given, T will be Response
    };

    // handle retry logic
    if (retry) {
      let retryOptions: RetryOptions<T> = {};
      if (retry !== true) {
        if (typeof retry === "number") retryOptions.maxTries = retry;
        else retryOptions = retry;
      }
      if (init.signal) retryOptions.signal = init.signal;
      return withRetry<T>(action, retryOptions);
    } else {
      return action();
    }
  };
}

export const knifetch = /*#__PURE__*/ createKnifetch();
