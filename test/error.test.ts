import { describe, expect, it } from "vitest";
import isNetworkError, { HttpError } from "../src/error";

describe("HttpError", () => {
  it("builds a message from status and statusText", () => {
    const err = new HttpError(
      new Response("x", { status: 503, statusText: "Service Unavailable" }),
    );
    expect(err.name).toBe("HttpError");
    expect(err.code).toBe("ERR_HTTP_RESPONSE_NOT_OK");
    expect(err.status).toBe(503);
    expect(err.message).toContain("status code 503 Service Unavailable");
    expect(err.response).toBeInstanceOf(Response);
  });

  it("handles a response with no status text", () => {
    // status 200 with empty statusText still produces a numeric status
    const err = new HttpError(new Response("x", { status: 400 }));
    expect(err.status).toBe(400);
    expect(err.message).toContain("status code 400");
  });

  it("exposes status via the getter reflecting the response", () => {
    const err = new HttpError(new Response(null, { status: 418 }));
    expect(err.status).toBe(418);
  });
});

describe("isNetworkError", () => {
  const makeTypeError = (message: string, stack?: string) => {
    const err = new TypeError(message);
    if (stack === undefined) {
      // Safari network errors have no stack
      Object.defineProperty(err, "stack", { value: undefined });
    }
    return err;
  };

  it("returns true for known network error messages", () => {
    for (const message of [
      "network error",
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "The Internet connection appears to be offline.",
      "Network request failed",
      "fetch failed",
      "terminated",
    ]) {
      expect(isNetworkError(new TypeError(message))).toBe(true);
    }
  });

  it("treats 'Load failed' as a network error only when there is no stack", () => {
    expect(isNetworkError(makeTypeError("Load failed", undefined))).toBe(true);
    // has a stack -> not a network error
    const withStack = new TypeError("Load failed");
    expect(isNetworkError(withStack)).toBe(false);
  });

  it("returns false for non-TypeError errors", () => {
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(false);
    expect(isNetworkError(new RangeError("network error"))).toBe(false);
  });

  it("returns false for unrelated TypeError messages", () => {
    expect(isNetworkError(new TypeError("something else"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    // @ts-expect-error testing runtime guard
    expect(isNetworkError(null)).toBe(false);
    // @ts-expect-error testing runtime guard
    expect(
      isNetworkError({ name: "TypeError", message: "Failed to fetch" }),
    ).toBe(false);
  });
});
