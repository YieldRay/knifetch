import { describe, expect, it } from "vitest";
import { CookieJar } from "../src/cookiejar";

/** Builds a Response whose `url` is set and carries the given Set-Cookie headers. */
function responseWithCookies(url: string, ...setCookies: string[]): Response {
  const headers = new Headers();
  for (const c of setCookies) headers.append("set-cookie", c);
  const response = new Response(null, { headers });
  // Response.url is read-only, so override it for the jar's URL parsing.
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}

describe("CookieJar", () => {
  it("stores and returns cookies for a matching URL", () => {
    const jar = new CookieJar();
    jar.setCookie(responseWithCookies("https://example.com/", "a=1; Path=/"));

    // The Cookie request header is name=value only, no attributes.
    expect(jar.getCookies("https://example.com/page")).toEqual(["a=1"]);
  });

  it("defaults domain and the directory path from the response URL", () => {
    const jar = new CookieJar();
    jar.setCookie(responseWithCookies("https://example.com/dir/x", "a=1"));

    const stored = jar.toJSON()[0];
    expect(stored.domain).toBe("example.com");
    // RFC 6265 §5.1.4: default path is the *directory* of the request URI.
    expect(stored.path).toBe("/dir");
  });

  it("does not send a cookie whose path does not match", () => {
    const jar = new CookieJar();
    jar.setCookie(
      responseWithCookies("https://example.com/", "a=1; Path=/admin"),
    );
    expect(jar.getCookies("https://example.com/public")).toEqual([]);
    expect(jar.getCookies("https://example.com/admin")).toEqual(["a=1"]);
  });

  it("matches subdomains against the cookie domain", () => {
    const jar = new CookieJar();
    jar.setCookie(
      responseWithCookies("https://example.com/", "a=1; Domain=example.com"),
    );
    expect(jar.getCookies("https://api.example.com/")).toEqual(["a=1"]);
  });

  it("does not match a look-alike domain suffix", () => {
    const jar = CookieJar.fromCookies([
      { name: "a", value: "1", domain: "example.com", path: "/" },
    ]);
    expect(jar.getCookies("https://notexample.com/")).toEqual([]);
  });

  it("does not send a Secure cookie over http", () => {
    const jar = CookieJar.fromCookies([
      { name: "a", value: "1", domain: "example.com", path: "/", secure: true },
    ]);
    expect(jar.getCookies("http://example.com/")).toEqual([]);
    expect(jar.getCookies("https://example.com/")).toEqual(["a=1"]);
  });

  it("drops a Secure cookie set over http (non-localhost)", () => {
    const jar = new CookieJar();
    jar.setCookie(responseWithCookies("http://example.com/", "a=1; Secure"));
    expect(jar.toJSON()).toEqual([]);
  });

  it("keeps cookies for localhost even without https", () => {
    const jar = new CookieJar();
    jar.setCookie(responseWithCookies("http://localhost/", "a=1; Secure"));
    expect(jar.getCookies("http://localhost/")).toEqual(["a=1"]);
  });

  it("rejects a cookie whose domain does not match the response host", () => {
    const jar = new CookieJar();
    jar.setCookie(
      responseWithCookies("https://example.com/", "a=1; Domain=evil.com"),
    );
    expect(jar.toJSON()).toEqual([]);
  });

  it("filters out expired cookies on read", () => {
    const jar = new CookieJar();
    jar.setCookie(
      responseWithCookies(
        "https://example.com/",
        `a=1; Expires=${new Date(Date.now() + 10_000).toUTCString()}`,
        `b=2; Expires=${new Date(Date.now() - 10_000).toUTCString()}`,
      ),
    );
    // expired b is removed at set time; a survives
    expect(jar.getCookies("https://example.com/")).toEqual(["a=1"]);
  });

  it("replaces a cookie with the same name/domain/path", () => {
    const jar = new CookieJar();
    jar.setCookie(responseWithCookies("https://example.com/", "a=1; Path=/"));
    jar.setCookie(responseWithCookies("https://example.com/", "a=2; Path=/"));
    expect(jar.getCookies("https://example.com/")).toEqual(["a=2"]);
  });

  it("expires a stored cookie via a non-positive Max-Age", () => {
    const jar = new CookieJar();
    jar.setCookie(
      responseWithCookies("https://example.com/", "a=1; Path=/; Max-Age=0"),
    );
    expect(jar.getCookies("https://example.com/")).toEqual([]);
  });

  it("removeCookies removes all when no domain is given", () => {
    const jar = CookieJar.fromCookies([
      { name: "a", value: "1", domain: "example.com", path: "/" },
      { name: "b", value: "2", domain: "example.com", path: "/" },
    ]);
    jar.removeCookies({});
    expect(jar.toJSON()).toEqual([]);
  });

  it("removeCookies removes by domain and name", () => {
    const jar = CookieJar.fromCookies([
      { name: "a", value: "1", domain: "example.com", path: "/" },
      { name: "b", value: "2", domain: "example.com", path: "/" },
    ]);
    jar.removeCookies({ domain: "example.com", name: "a" });
    expect(jar.toJSON().map((c) => c.name)).toEqual(["b"]);
  });

  it("removeCookies removes by domain, path, and name", () => {
    const jar = CookieJar.fromCookies([
      { name: "a", value: "1", domain: "example.com", path: "/admin" },
      { name: "a", value: "2", domain: "example.com", path: "/public" },
    ]);
    jar.removeCookies({ domain: "example.com", name: "a", path: "/admin" });
    expect(jar.toJSON().map((c) => c.path)).toEqual(["/public"]);
  });

  it("getCookies accepts a Request input", () => {
    const jar = CookieJar.fromCookies([
      { name: "a", value: "1", domain: "example.com", path: "/" },
    ]);
    const req = new Request("https://example.com/page");
    expect(jar.getCookies(req)).toEqual(["a=1"]);
  });

  it("keeps a cookie with a positive Max-Age", () => {
    const jar = new CookieJar();
    jar.setCookie(
      responseWithCookies("https://example.com/", "a=1; Path=/; Max-Age=100"),
    );
    expect(jar.getCookies("https://example.com/")).toEqual(["a=1"]);
  });

  it("matches paths at a segment boundary but not a prefix", () => {
    const jar = CookieJar.fromCookies([
      { name: "a", value: "1", domain: "example.com", path: "/foo" },
    ]);
    // exact and sub-path match
    expect(jar.getCookies("https://example.com/foo")).toEqual(["a=1"]);
    expect(jar.getCookies("https://example.com/foo/bar")).toEqual(["a=1"]);
    // prefix that is not a boundary must NOT match
    expect(jar.getCookies("https://example.com/foobar")).toEqual([]);
  });

  it("ignores a Response with no url", () => {
    const jar = new CookieJar();
    const res = new Response(null, {
      headers: { "set-cookie": "a=1" },
    });
    // default Response.url is "" -> skipped
    jar.setCookie(res);
    expect(jar.toJSON()).toEqual([]);
  });

  it("defaults the path to / for a root-level request", () => {
    const jar = new CookieJar();
    jar.setCookie(responseWithCookies("https://example.com/x", "a=1"));
    expect(jar.toJSON()[0].path).toBe("/");
  });

  it("removeCookies with a directory path removes nested cookies", () => {
    const jar = CookieJar.fromCookies([
      { name: "a", value: "1", domain: "example.com", path: "/admin/users" },
      { name: "b", value: "2", domain: "example.com", path: "/public" },
    ]);
    jar.removeCookies({ domain: "example.com", name: "a", path: "/admin/" });
    expect(jar.toJSON().map((c) => c.name)).toEqual(["b"]);
  });

  it("removeCookies defaults a pathless cookie to / when matching by path", () => {
    const jar = CookieJar.fromCookies([
      // no `path` -> treated as "/"
      { name: "a", value: "1", domain: "example.com" },
    ]);
    // path "/other" does not match "/", so the cookie is kept
    jar.removeCookies({ domain: "example.com", name: "a", path: "/other" });
    expect(jar.toJSON().map((c) => c.name)).toEqual(["a"]);
    // path "/" matches, so it is removed
    jar.removeCookies({ domain: "example.com", name: "a", path: "/" });
    expect(jar.toJSON()).toEqual([]);
  });

  it("fromCookies seeds the store", () => {
    const jar = CookieJar.fromCookies([
      { name: "a", value: "1", domain: "example.com", path: "/" },
    ]);
    expect(jar.toJSON()).toHaveLength(1);
  });
});
