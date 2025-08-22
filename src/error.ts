/**
 * Port of https://github.com/sindresorhus/is-network-error/blob/main/index.js
 */

const isError = (value: unknown) =>
  Object.prototype.toString.call(value) === "[object Error]";

const errorMessages = /*#__PURE__*/ new Set([
  "network error", // Chrome
  "Failed to fetch", // Chrome
  "NetworkError when attempting to fetch resource.", // Firefox
  "The Internet connection appears to be offline.", // Safari 16
  "Load failed", // Safari 17+
  "Network request failed", // `cross-fetch`
  "fetch failed", // Undici (Node.js)
  "terminated", // Undici (Node.js)
]);

export default function isNetworkError(error: Error): boolean {
  const isValid =
    error &&
    isError(error) &&
    error.name === "TypeError" &&
    typeof error.message === "string";

  if (!isValid) {
    return false;
  }

  // We do an extra check for Safari 17+ as it has a very generic error message.
  // Network errors in Safari have no stack.
  if (error.message === "Load failed") {
    return error.stack === undefined;
  }

  return errorMessages.has(error.message);
}

export class HttpError extends Error {
  readonly name = "HttpError";
  readonly code = "ERR_HTTP_RESPONSE_NOT_OK";
  response: Response;

  constructor(response: Response) {
    const status = `${response.status} ${response.statusText}`.trim();
    const reason = status ? `status code ${status}` : "an unknown error";
    super(`Request failed with ${reason}: ${response.url}`);
    // @ts-ignore
    Error.captureStackTrace?.(this, this.constructor);
    this.response = response;
  }
}
