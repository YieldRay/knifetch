import { CookieJar } from "./cookiejar";
import { retry as withRetry, type RetryOptions } from "./retry";
import type { Awaitable, Nullable } from "./types";

export type Fetch = typeof fetch;

/**
 * A type that can be convert to string if is not string
 */
type TString = string | number;

/**
 * Extends the built-in RequestInit interface with additional options.
 */
interface KRequestInit extends RequestInit {
  /**
   * Append query parameters to the URL, null and undefined value will be ignored
   */
  query?: Record<string, Nullable<TString>>;
  /**
   * JSON body, sets Content-Type to 'application/json'.
   * @note this is intend for sending object or array, should NOT use other primitive value
   */
  json?: Record<PropertyKey, unknown> | Array<unknown>;
  /**
   * FormData body, sets Content-Type to 'multipart/form-data'. If an object is provided, null and undefined values will be ignored.
   */
  formData?: FormData | Record<string, Nullable<TString | Blob>>;
  /**
   * URLSearchParams body, sets Content-Type to 'application/x-www-form-urlencoded'. If an object is provided, null and undefined values will be ignored.
   */
  form?: URLSearchParams | Record<string, Nullable<TString>>;
  /**
   * Set to true to enable automatic retry
   */
  retry?:
    | boolean
    | number
    | Pick<RetryOptions<unknown>, "delay" | "maxTries" | "timeout">;
}

/**
 * Options for the createKnifetch function.
 */
interface KnifetchOptions<T> {
  /**
   * The fetch function to use. Defaults to globalThis.fetch.
   */
  fetch?: Fetch;
  /**
   * Base URL to prepend to all requests. Only works if you pass string as request url (rather than URL/Request object).
   */
  baseURL?: string;
  /**
   * Cookie jar to use for managing cookies.
   */
  cookieJar?: boolean | CookieJar;
  /**
   * Interceptor function called before each request.
   */
  onRequest?({ request }: { request: Request }): Awaitable<Request | void>;
  /**
   * Interceptor function called after each response.
   */
  onResponse?({
    request,
    response,
  }: {
    request: Request;
    response: Response;
  }): Awaitable<Response | void>;
  /**
   * Error handler function called when a fetch request fails.
   * @note if returns a Response, it will also trigger `onResponse`
   */
  onFetchError?({
    request,
    error,
  }: {
    request: Request;
    error: unknown;
  }): Awaitable<Response | void>;
  /**
   * Function to transform the response before returning it.
   */
  transformResponse?(response: Response): Awaitable<T>;
}

/**
 * Creates a custom fetch function with enhanced features.
 * @returns A custom fetch function.
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

export const knifetch = createKnifetch();
