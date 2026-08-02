import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Cookie,
  cookieToString,
  deleteCookie,
  getCookies,
  getSetCookies,
  setCookie,
} from "../src/cookie";

afterEach(() => vi.restoreAllMocks());

describe("cookieToString", () => {
  it("returns an empty string for a nameless cookie", () => {
    expect(cookieToString({ name: "", value: "x" })).toBe("");
  });

  it("serializes a basic name=value", () => {
    expect(cookieToString({ name: "a", value: "b" })).toBe("a=b");
  });

  it("serializes all attributes", () => {
    const out = cookieToString({
      name: "id",
      value: "42",
      secure: true,
      httpOnly: true,
      partitioned: true,
      maxAge: 3600,
      domain: "example.com",
      sameSite: "Lax",
      path: "/app",
      expires: 1_700_000_000_000,
      unparsed: ["foo=bar"],
    });
    expect(out).toContain("id=42");
    expect(out).toContain("Secure");
    expect(out).toContain("HttpOnly");
    expect(out).toContain("Partitioned");
    expect(out).toContain("Max-Age=3600");
    expect(out).toContain("Domain=example.com");
    expect(out).toContain("SameSite=Lax");
    expect(out).toContain("Path=/app");
    expect(out).toContain("Expires=");
    expect(out).toContain("foo=bar");
  });

  it("serializes expires given as a Date", () => {
    const out = cookieToString({
      name: "a",
      value: "b",
      expires: new Date(0),
    });
    expect(out).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("forces Secure for __Secure- prefix", () => {
    expect(cookieToString({ name: "__Secure-x", value: "1" })).toContain(
      "Secure",
    );
  });

  it("forces path=/ and Secure and drops domain for __Host- prefix", () => {
    const out = cookieToString({
      name: "__Host-x",
      value: "1",
      domain: "example.com",
      path: "/nested",
    });
    expect(out).toContain("Secure");
    expect(out).toContain("Path=/");
    expect(out).not.toContain("Domain=");
  });

  it("throws for a negative Max-Age", () => {
    expect(() => cookieToString({ name: "a", value: "b", maxAge: -1 })).toThrow(
      RangeError,
    );
  });

  it("throws for an invalid cookie name", () => {
    expect(() => cookieToString({ name: "a b", value: "1" })).toThrow(
      SyntaxError,
    );
  });

  it("throws for an invalid cookie value", () => {
    expect(() => cookieToString({ name: "a", value: "b;c" })).toThrow(
      SyntaxError,
    );
  });

  it("throws for a non-ASCII (>0x80) value character", () => {
    expect(() => cookieToString({ name: "a", value: "\u00FF" })).toThrow(
      SyntaxError,
    );
  });

  it("throws for an invalid path character", () => {
    expect(() =>
      cookieToString({ name: "a", value: "b", path: "/x;y" }),
    ).toThrow(SyntaxError);
  });

  it("throws for an invalid domain", () => {
    expect(() =>
      cookieToString({ name: "a", value: "b", domain: "-bad" }),
    ).toThrow(SyntaxError);
    expect(() =>
      cookieToString({ name: "a", value: "b", domain: "bad-" }),
    ).toThrow(SyntaxError);
    expect(() =>
      cookieToString({ name: "a", value: "b", domain: "bad." }),
    ).toThrow(SyntaxError);
  });
});

describe("getCookies", () => {
  it("parses the Cookie header into an object", () => {
    const headers = new Headers({ Cookie: "a=1; b=2; c=x=y" });
    expect(getCookies(headers)).toEqual({ a: "1", b: "2", c: "x=y" });
  });

  it("returns an empty object when no Cookie header is present", () => {
    expect(getCookies(new Headers())).toEqual({});
  });
});

describe("setCookie / deleteCookie", () => {
  it("appends a Set-Cookie header", () => {
    const headers = new Headers();
    setCookie(headers, { name: "a", value: "1" });
    expect(headers.get("set-cookie")).toBe("a=1");
  });

  it("does not append for a nameless cookie", () => {
    const headers = new Headers();
    setCookie(headers, { name: "", value: "1" });
    expect(headers.get("set-cookie")).toBeNull();
  });

  it("deleteCookie sets an expired cookie", () => {
    const headers = new Headers();
    deleteCookie(headers, "a", { path: "/", domain: "example.com" });
    const value = headers.get("set-cookie")!;
    expect(value).toContain("a=");
    expect(value).toContain("Expires=Thu, 01 Jan 1970");
    expect(value).toContain("Path=/");
    expect(value).toContain("Domain=example.com");
  });
});

describe("getSetCookies", () => {
  const headersWith = (...values: string[]) => {
    const h = new Headers();
    for (const v of values) h.append("set-cookie", v);
    return h;
  };

  it("parses a simple set-cookie", () => {
    const [cookie] = getSetCookies(headersWith("a=1"));
    expect(cookie).toMatchObject({ name: "a", value: "1" });
  });

  it("parses all recognized attributes", () => {
    const [cookie] = getSetCookies(
      headersWith(
        "id=42; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Max-Age=100; Domain=.example.com; Path=/; Secure; HttpOnly; SameSite=Strict; Custom=zzz",
      ),
    );
    expect(cookie.name).toBe("id");
    expect(cookie.value).toBe("42");
    expect(cookie.expires).toBeInstanceOf(Date);
    expect(cookie.maxAge).toBe(100);
    expect(cookie.domain).toBe("example.com"); // leading dot stripped
    expect(cookie.path).toBe("/");
    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    expect(cookie.unparsed).toContain("Custom=zzz");
  });

  it("ignores a cookie with a negative Max-Age", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getSetCookies(headersWith("a=1; Max-Age=-1"))).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("ignores __Secure- cookies without Secure", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getSetCookies(headersWith("__Secure-a=1"))).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("accepts __Secure- cookies with Secure", () => {
    const [cookie] = getSetCookies(headersWith("__Secure-a=1; Secure"));
    expect(cookie.name).toBe("__Secure-a");
  });

  it("ignores __Host- cookies without Secure", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getSetCookies(headersWith("__Host-a=1; Path=/"))).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("ignores __Host- cookies with a domain", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      getSetCookies(
        headersWith("__Host-a=1; Secure; Path=/; Domain=example.com"),
      ),
    ).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("ignores __Host- cookies whose path is not /", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getSetCookies(headersWith("__Host-a=1; Secure; Path=/x"))).toEqual(
      [],
    );
    expect(warn).toHaveBeenCalled();
  });

  it("accepts a valid __Host- cookie", () => {
    const [cookie] = getSetCookies(headersWith("__Host-a=1; Secure; Path=/"));
    expect(cookie).toMatchObject({ name: "__Host-a", path: "/", secure: true });
  });

  it("returns [] when there are no set-cookie headers", () => {
    expect(getSetCookies(new Headers())).toEqual([]);
  });

  it("parses multiple set-cookie headers", () => {
    const cookies = getSetCookies(headersWith("a=1", "b=2"));
    expect(cookies.map((c: Cookie) => c.name)).toEqual(["a", "b"]);
  });
});
