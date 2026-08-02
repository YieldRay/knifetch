import { describe, expect, it, vi } from "vitest";
import { createKnifetch, type Fetch } from "../src/core";
import { CookieJar } from "../src/cookiejar";

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

  describe("retry", () => {
    it("retries a failing fetch until it succeeds", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        if (attempts < 2) throw new Error("temporary");
        return new Response("recovered");
      }) as unknown as Fetch;

      const kf = createKnifetch({ fetch });
      const res = await kf("https://example.com/", { retry: 3 });

      expect(attempts).toBe(2);
      expect(await res.text()).toBe("recovered");
    });

    it("does not retry when retry is falsy", async () => {
      const fetch = vi.fn(async () => {
        throw new Error("fail");
      }) as unknown as Fetch;
      const kf = createKnifetch({ fetch });

      await expect(kf("https://example.com/")).rejects.toThrowError("fail");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("accepts an options object for retry", async () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts++;
        if (attempts < 3) throw new Error("temporary");
        return new Response("ok");
      }) as unknown as Fetch;

      const kf = createKnifetch({ fetch });
      const res = await kf("https://example.com/", {
        retry: { maxTries: 5, delay: 0 },
      });

      expect(attempts).toBe(3);
      expect(await res.text()).toBe("ok");
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
  });
});
