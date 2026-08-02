import { describe, expect, it, vi } from "vitest";
import { createKnifetch, type Fetch } from "../src/core";
import { CookieJar } from "../src/cookiejar";
import { HttpError } from "../src/error";

/**
 * Creates a mock fetch that records the Request it receives and returns
 * a configurable Response.
 */
function mockFetch(
  response: Response | (() => Response | Promise<Response>) = new Response(
    "ok",
  ),
) {
  const calls: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input);
    calls.push(request);
    return typeof response === "function" ? response() : response;
  }) as unknown as Fetch;
  return { fetch, calls };
}

describe("createKnifetch", () => {
  it("returns the raw Response by default", async () => {
    const { fetch } = mockFetch(new Response("hello"));
    const kf = createKnifetch({ fetch });

    const res = await kf("https://example.com/");
    expect(res).toBeInstanceOf(Response);
    expect(await res.text()).toBe("hello");
  });

  it("prepends baseURL for string inputs", async () => {
    const { fetch, calls } = mockFetch();
    const kf = createKnifetch({ fetch, baseURL: "https://api.test" });

    await kf("/users");
    expect(calls[0].url).toBe("https://api.test/users");
  });

  it("does not prepend baseURL for URL inputs", async () => {
    const { fetch, calls } = mockFetch();
    const kf = createKnifetch({ fetch, baseURL: "https://api.test" });

    await kf(new URL("https://other.test/path"));
    expect(calls[0].url).toBe("https://other.test/path");
  });

  describe("body handling", () => {
    it("serializes json and sets content-type + POST method", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/", { json: { a: 1, b: "two" } });

      const req = calls[0];
      expect(req.method).toBe("POST");
      expect(req.headers.get("content-type")).toBe("application/json");
      expect(await req.text()).toBe(JSON.stringify({ a: 1, b: "two" }));
    });

    it("serializes form (object) as urlencoded and skips null/undefined", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/", {
        form: { a: "1", b: 2, skip: null, gone: undefined },
      });

      const req = calls[0];
      expect(req.method).toBe("POST");
      expect(req.headers.get("content-type")).toBe(
        "application/x-www-form-urlencoded",
      );
      const body = await req.text();
      const params = new URLSearchParams(body);
      expect(params.get("a")).toBe("1");
      expect(params.get("b")).toBe("2");
      expect(params.has("skip")).toBe(false);
      expect(params.has("gone")).toBe(false);
    });

    it("passes through a URLSearchParams form instance", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });
      const form = new URLSearchParams({ x: "y" });

      await kf("https://example.com/", { form });

      const req = calls[0];
      expect(new URLSearchParams(await req.text()).get("x")).toBe("y");
    });

    it("serializes formData (object) as multipart and skips null/undefined", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/", {
        formData: { name: "alice", age: 30, skip: null, gone: undefined },
      });

      const req = calls[0];
      expect(req.method).toBe("POST");
      // fetch/Request sets the multipart boundary content-type automatically
      expect(req.headers.get("content-type")).toMatch(/^multipart\/form-data/);

      const fd = await req.formData();
      expect(fd.get("name")).toBe("alice");
      expect(fd.get("age")).toBe("30");
      expect(fd.has("skip")).toBe(false);
      expect(fd.has("gone")).toBe(false);
    });

    it("passes through a FormData instance", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });
      const fd = new FormData();
      fd.set("k", "v");

      await kf("https://example.com/", { formData: fd });

      const parsed = await calls[0].formData();
      expect(parsed.get("k")).toBe("v");
    });

    it("does not override an explicit content-type header", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/", {
        json: { a: 1 },
        headers: { "content-type": "application/vnd.custom+json" },
      });

      expect(calls[0].headers.get("content-type")).toBe(
        "application/vnd.custom+json",
      );
    });

    it("respects an explicit method over the POST default", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/", { method: "PUT", json: { a: 1 } });
      expect(calls[0].method).toBe("PUT");
    });

    it("uses an explicit body as-is and skips helpers", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/", { method: "POST", body: "raw-body" });
      expect(await calls[0].text()).toBe("raw-body");
    });
  });

  describe("query params", () => {
    it("appends query params, coercing values to strings", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/search", {
        query: { q: "hello", page: 2 },
      });

      const url = new URL(calls[0].url);
      expect(url.searchParams.get("q")).toBe("hello");
      expect(url.searchParams.get("page")).toBe("2");
    });

    it("merges query params with existing ones in the URL", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/?existing=1", { query: { added: "2" } });

      const url = new URL(calls[0].url);
      expect(url.searchParams.get("existing")).toBe("1");
      expect(url.searchParams.get("added")).toBe("2");
    });

    it("appends query params when input is a Request", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch });

      await kf(new Request("https://example.com/"), { query: { a: "1" } });
      expect(new URL(calls[0].url).searchParams.get("a")).toBe("1");
    });
  });

  describe("interceptors", () => {
    it("calls onRequest and uses a returned Request", async () => {
      const { fetch, calls } = mockFetch();
      const onRequest = vi.fn(() => new Request("https://replaced.test/"));
      const kf = createKnifetch({ fetch, onRequest });

      await kf("https://example.com/");
      expect(onRequest).toHaveBeenCalledOnce();
      expect(calls[0].url).toBe("https://replaced.test/");
    });

    it("keeps the original Request when onRequest returns void", async () => {
      const { fetch, calls } = mockFetch();
      const onRequest = vi.fn(() => undefined);
      const kf = createKnifetch({ fetch, onRequest });

      await kf("https://example.com/");
      expect(calls[0].url).toBe("https://example.com/");
    });

    it("calls onResponse and uses a returned Response", async () => {
      const { fetch } = mockFetch(new Response("original"));
      const onResponse = vi.fn(() => new Response("replaced"));
      const kf = createKnifetch({ fetch, onResponse });

      const res = await kf("https://example.com/");
      expect(onResponse).toHaveBeenCalledOnce();
      expect(await res.text()).toBe("replaced");
    });

    it("recovers from a fetch error when onFetchError returns a Response", async () => {
      const fetch = vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as Fetch;
      const onFetchError = vi.fn(() => new Response("fallback"));
      const kf = createKnifetch({ fetch, onFetchError });

      const res = await kf("https://example.com/");
      expect(onFetchError).toHaveBeenCalledOnce();
      expect(await res.text()).toBe("fallback");
    });

    it("rethrows the fetch error when onFetchError returns void", async () => {
      const fetch = vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as Fetch;
      const onFetchError = vi.fn(() => undefined);
      const kf = createKnifetch({ fetch, onFetchError });

      await expect(kf("https://example.com/")).rejects.toThrowError("boom");
    });

    it("rethrows the fetch error when no onFetchError is provided", async () => {
      const fetch = vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      await expect(kf("https://example.com/")).rejects.toThrowError("boom");
    });

    it("applies transformResponse and types the result", async () => {
      const { fetch } = mockFetch(Response.json({ ok: true }));
      const kf = createKnifetch<{ ok: boolean }>({
        fetch,
        transformResponse: (res) => res.json(),
      });

      const data = await kf("https://example.com/");
      expect(data).toEqual({ ok: true });
    });

    it("runs interceptors in order: onRequest -> fetch -> onResponse -> transform", async () => {
      const order: string[] = [];
      const fetch = vi.fn(async (input: RequestInfo | URL) => {
        order.push("fetch");
        void input;
        return new Response("body");
      }) as unknown as Fetch;

      const kf = createKnifetch({
        fetch,
        onRequest: () => {
          order.push("onRequest");
        },
        onResponse: () => {
          order.push("onResponse");
        },
        transformResponse: async (res) => {
          order.push("transform");
          return res.text();
        },
      });

      await kf("https://example.com/");
      expect(order).toEqual(["onRequest", "fetch", "onResponse", "transform"]);
    });
  });

  describe("throwHttpErrors", () => {
    it("rejects with HttpError on non-2xx by default", async () => {
      const { fetch } = mockFetch(new Response("nope", { status: 404 }));
      const kf = createKnifetch({ fetch });

      const err = await kf("https://example.com/").catch((error_) => error_);
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(404);
      expect(err.response).toBeInstanceOf(Response);
    });

    it("resolves with the Response when throwHttpErrors is false", async () => {
      const { fetch } = mockFetch(new Response("nope", { status: 500 }));
      const kf = createKnifetch({ fetch, throwHttpErrors: false });

      const res = await kf("https://example.com/");
      expect(res).toBeInstanceOf(Response);
      expect(res.status).toBe(500);
    });

    it("does not throw on 2xx", async () => {
      const { fetch } = mockFetch(new Response(null, { status: 204 }));
      const kf = createKnifetch({ fetch });
      await expect(kf("https://example.com/")).resolves.toBeInstanceOf(
        Response,
      );
    });
  });

  describe("retry", () => {
    // fast, deterministic backoff for tests
    const fast = { minTimeout: 0, jitter: false } as const;

    it("retry: true uses default HTTP-aware options", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        return attempts < 2
          ? new Response("busy", {
              status: 503,
              // Retry-After: 0 to avoid the default 1s backoff
              headers: { "retry-after": "0" },
            })
          : new Response("ok");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      const res = await kf("https://example.com/", { retry: true });
      expect((res as Response).ok).toBe(true);
      expect(attempts).toBe(2);
    });

    it("does not retry when retry is falsy", async () => {
      const { fetch } = mockFetch(new Response("x", { status: 500 }));
      const kf = createKnifetch({ fetch });

      await expect(kf("https://example.com/")).rejects.toBeInstanceOf(
        HttpError,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("retries a retryable status code until success", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        return attempts < 3
          ? new Response("busy", { status: 503 })
          : new Response("ok", { status: 200 });
      }) as unknown as Fetch;

      const kf = createKnifetch({ fetch });
      const res = await kf("https://example.com/", {
        retry: { retries: 5, ...fast },
      });

      expect(attempts).toBe(3);
      expect((res as Response).status).toBe(200);
    });

    it("does NOT retry a non-retryable status code (404)", async () => {
      const { fetch } = mockFetch(new Response("nf", { status: 404 }));
      const kf = createKnifetch({ fetch });

      await expect(
        kf("https://example.com/", { retry: { retries: 3, ...fast } }),
      ).rejects.toBeInstanceOf(HttpError);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry POST by default (non-idempotent)", async () => {
      const { fetch } = mockFetch(new Response("busy", { status: 503 }));
      const kf = createKnifetch({ fetch });

      await expect(
        kf("https://example.com/", {
          method: "POST",
          json: { a: 1 },
          retry: { retries: 3, ...fast },
        }),
      ).rejects.toBeInstanceOf(HttpError);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("retries POST when explicitly allowed via methods", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        return attempts < 2
          ? new Response("busy", { status: 503 })
          : new Response("ok");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      const res = await kf("https://example.com/", {
        method: "POST",
        retry: { retries: 3, methods: ["POST"], ...fast },
      });
      expect(attempts).toBe(2);
      expect((res as Response).ok).toBe(true);
    });

    it("retries GET (idempotent) by default", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        return attempts < 2
          ? new Response("busy", { status: 502 })
          : new Response("ok");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/", { retry: { retries: 3, ...fast } });
      expect(attempts).toBe(2);
    });

    it("respects a custom statusCodes list", async () => {
      const { fetch } = mockFetch(new Response("teapot", { status: 418 }));
      const kf = createKnifetch({ fetch });

      // 418 is not retryable by default -> fails after 1
      await expect(
        kf("https://example.com/a", { retry: { retries: 2, ...fast } }),
      ).rejects.toBeInstanceOf(HttpError);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("retries network errors (TypeError from fetch)", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        if (attempts < 2) {
          throw new TypeError("Failed to fetch");
        }
        return new Response("ok");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/", { retry: { retries: 3, ...fast } });
      expect(attempts).toBe(2);
    });

    it("does NOT retry a non-network thrown error", async () => {
      const fetch = vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      await expect(
        kf("https://example.com/", { retry: { retries: 3, ...fast } }),
      ).rejects.toThrowError("boom");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("accepts a number shorthand for retries", async () => {
      // The number form uses the default backoff; a `Retry-After: 0` header
      // makes each retry fire immediately so the test stays fast.
      const { fetch } = mockFetch(
        new Response("busy", {
          status: 503,
          headers: { "retry-after": "0" },
        }),
      );
      const kf = createKnifetch({ fetch });

      // retries: 2 => 3 attempts.
      await expect(
        kf("https://example.com/", { retry: 2 }),
      ).rejects.toBeInstanceOf(HttpError);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("honors Retry-After (seconds) via calculateDelay", async () => {
      let attempts = 0;
      const delays: number[] = [];
      const start = Date.now();
      const fetch = vi.fn(async () => {
        if (attempts > 0) delays.push(Date.now() - start);
        attempts++;
        return attempts < 2
          ? new Response("slow", {
              status: 429,
              headers: { "retry-after": "0" },
            })
          : new Response("ok");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      const res = await kf("https://example.com/", {
        retry: { retries: 3, jitter: false, minTimeout: 10_000 },
      });
      // Retry-After: 0 should override the 10s backoff -> fast retry
      expect((res as Response).ok).toBe(true);
      expect(delays[0]).toBeLessThan(1000);
    });

    it("honors Retry-After given as an HTTP-date", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        return attempts < 2
          ? new Response("slow", {
              status: 503,
              // a date in the past -> delay clamps to 0
              headers: { "retry-after": new Date(0).toUTCString() },
            })
          : new Response("ok");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      const res = await kf("https://example.com/", {
        retry: { retries: 3, jitter: false, minTimeout: 10_000 },
      });
      expect((res as Response).ok).toBe(true);
      expect(attempts).toBe(2);
    });

    it("falls back to backoff when Retry-After is unparseable", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        return attempts < 2
          ? new Response("slow", {
              status: 503,
              headers: { "retry-after": "not-a-date" },
            })
          : new Response("ok");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      const res = await kf("https://example.com/", {
        retry: { retries: 3, minTimeout: 0, jitter: false },
      });
      expect((res as Response).ok).toBe(true);
      expect(attempts).toBe(2);
    });

    it("forwards the user's signal to abort the whole retry", async () => {
      const controller = new AbortController();
      const fetch = vi.fn(async () => {
        controller.abort(new Error("user cancelled"));
        return new Response("busy", { status: 503 });
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      await expect(
        kf("https://example.com/", {
          signal: controller.signal,
          retry: { retries: 5, minTimeout: 50, jitter: false },
        }),
      ).rejects.toThrowError("user cancelled");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("re-sends the request body across retries (clone)", async () => {
      const bodies: string[] = [];
      let attempts = 0;
      const fetch = vi.fn(async (req: Request) => {
        bodies.push(await req.text());
        attempts++;
        return attempts < 2
          ? new Response("busy", { status: 503 })
          : new Response("ok");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      await kf("https://example.com/", {
        method: "PUT",
        json: { hello: "world" },
        retry: { retries: 3, ...fast },
      });

      expect(bodies).toHaveLength(2);
      expect(bodies[0]).toBe(JSON.stringify({ hello: "world" }));
      expect(bodies[1]).toBe(bodies[0]);
    });

    it("aborts the in-flight fetch on per-attempt timeout", async () => {
      let sawAbort = false;
      const fetch = vi.fn(
        (req: Request) =>
          new Promise<Response>((resolve, reject) => {
            req.signal.addEventListener("abort", () => {
              sawAbort = true;
              reject(req.signal.reason);
            });
            // never resolves on its own within the timeout
            setTimeout(() => resolve(new Response("late")), 1000);
          }),
      ) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      await expect(
        kf("https://example.com/", {
          retry: { retries: 0, timeout: 20, ...fast },
        }),
      ).rejects.toBeTruthy();
      expect(sawAbort).toBe(true);
    });

    it("supports a custom shouldRetry predicate", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        return new Response("nf", { status: 404 });
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      // normally 404 isn't retried; custom predicate forces it
      await expect(
        kf("https://example.com/", {
          retry: {
            retries: 2,
            ...fast,
            shouldRetry: ({ error }) =>
              error instanceof HttpError && error.status === 404,
          },
        }),
      ).rejects.toBeInstanceOf(HttpError);
      expect(attempts).toBe(3);
    });
  });

  describe("cookieJar", () => {
    it("sends stored cookies on matching requests", async () => {
      const { fetch, calls } = mockFetch();
      const jar = CookieJar.fromCookies([
        { name: "session", value: "abc", domain: "example.com", path: "/" },
      ]);
      const kf = createKnifetch({ fetch, cookieJar: jar });

      await kf("https://example.com/dashboard");
      expect(calls[0].headers.get("cookie")).toContain("session=abc");
    });

    it("creates an internal jar when cookieJar is true", async () => {
      const { fetch, calls } = mockFetch();
      const kf = createKnifetch({ fetch, cookieJar: true });

      // no cookies stored yet -> no cookie header
      await kf("https://example.com/");
      expect(calls[0].headers.get("cookie")).toBeNull();
    });

    it("does not override an explicit cookie header", async () => {
      const { fetch, calls } = mockFetch();
      const jar = CookieJar.fromCookies([
        { name: "session", value: "abc", domain: "example.com", path: "/" },
      ]);
      const kf = createKnifetch({ fetch, cookieJar: jar });

      await kf("https://example.com/", { headers: { cookie: "manual=1" } });
      expect(calls[0].headers.get("cookie")).toBe("manual=1");
    });

    it("stores Set-Cookie from a response and sends it on the next request", async () => {
      const jar = new CookieJar();
      let call = 0;
      const fetch = vi.fn(async () => {
        call++;
        if (call === 1) {
          const headers = new Headers({ "set-cookie": "session=xyz; Path=/" });
          const res = new Response(null, { headers });
          Object.defineProperty(res, "url", {
            value: "https://example.com/login",
          });
          return res;
        }
        const res = new Response("ok");
        Object.defineProperty(res, "url", { value: "https://example.com/me" });
        return res;
      }) as unknown as Fetch;

      const kf = createKnifetch({ fetch, cookieJar: jar });
      await kf("https://example.com/login");
      await kf("https://example.com/me");

      const secondRequest = fetch.mock.calls[1][0] as Request;
      expect(secondRequest.headers.get("cookie")).toBe("session=xyz");
    });
  });
});
