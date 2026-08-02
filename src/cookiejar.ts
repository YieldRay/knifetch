import { type Cookie, getSetCookies } from "./cookie";

/**
 * A minimal, server-side cookie store.
 *
 * It follows the parts of {@link https://www.rfc-editor.org/rfc/rfc6265 RFC 6265}
 * that matter for a `fetch` client — domain/path matching, `Secure`, expiry via
 * `Expires`/`Max-Age`, and replacement of same-identity cookies — but does not
 * implement the public-suffix list or partitioned (CHIPS) cookies. It is not
 * intended for use in browsers, where the platform manages cookies.
 */
export class CookieJar {
  private _store: Cookie[] = [];

  /** Absolute expiry time in ms since epoch, or `undefined` for a session cookie. */
  private static expiryOf(cookie: Cookie): number | undefined {
    if (cookie.maxAge != undefined) {
      // Max-Age is relative; we can only approximate "now" at read time, so we
      // treat a non-positive Max-Age as already expired.
      return cookie.maxAge <= 0 ? 0 : Date.now() + cookie.maxAge * 1000;
    }
    if (cookie.expires != undefined) return Number(cookie.expires);
    return undefined;
  }

  private static isExpired(cookie: Cookie): boolean {
    const expiry = CookieJar.expiryOf(cookie);
    return expiry != undefined && expiry <= Date.now();
  }

  /** Two cookies share identity (and thus replace each other) by name+domain+path. */
  private static sameIdentity(a: Cookie, b: Cookie): boolean {
    return a.name === b.name && a.domain === b.domain && a.path === b.path;
  }

  /** A cookie's `domain` matches a request `host` (host-only or domain-match). */
  private static domainMatches(cookieDomain: string, host: string): boolean {
    return cookieDomain === host || host.endsWith(`.${cookieDomain}`);
  }

  /** A cookie's `path` matches a request `pathname` per RFC 6265 §5.1.4. */
  private static pathMatches(cookiePath: string, pathname: string): boolean {
    if (pathname === cookiePath) return true;
    if (!pathname.startsWith(cookiePath)) return false;
    return cookiePath.endsWith("/") || pathname[cookiePath.length] === "/";
  }

  private _removeExpired(): Cookie[] {
    this._store = this._store.filter((cookie) => !CookieJar.isExpired(cookie));
    return this._store;
  }

  /**
   * Stores the `Set-Cookie` headers from a {@link Response}. Cookies that fail
   * validation (wrong domain, `Secure` over http, already expired) are dropped;
   * cookies that replace an existing one (same name/domain/path) overwrite it.
   */
  setCookie(response: Response): void {
    if (!response.url) return;
    const url = new URL(response.url);
    const host = url.hostname;
    const isLocalhost = host === "localhost";

    for (const cookie of getSetCookies(response.headers)) {
      // Apply defaults from the request URL (RFC 6265 §4.1.2.3 / §5.1.4).
      cookie.domain ??= host;
      cookie.path ??= defaultPath(url.pathname);

      // A Secure cookie must arrive over a secure transport.
      if (!isLocalhost && cookie.secure && url.protocol !== "https:") continue;

      // The cookie's domain must match the origin host.
      if (!isLocalhost && !CookieJar.domainMatches(cookie.domain, host))
        continue;

      // Replace any existing cookie with the same identity, then store (unless
      // the incoming cookie is already expired, in which case it just deletes).
      this._store = this._store.filter(
        (c) => !CookieJar.sameIdentity(c, cookie),
      );
      if (!CookieJar.isExpired(cookie)) this._store.push(cookie);
    }
  }

  /**
   * Returns the `Cookie` request-header values (`name=value`) that apply to the
   * given request URL.
   */
  getCookies(input: RequestInfo | URL): string[] {
    const url = new URL(input instanceof Request ? input.url : input);
    const { hostname: host, pathname } = url;
    const secureTransport = url.protocol === "https:" || host === "localhost";

    return this._removeExpired()
      .filter(
        (cookie) =>
          CookieJar.domainMatches(cookie.domain!, host) &&
          CookieJar.pathMatches(cookie.path!, pathname) &&
          (secureTransport || !cookie.secure),
      )
      .map((cookie) => `${cookie.name}=${cookie.value}`);
  }

  /**
   * Removes stored cookies. With no `domain`, clears everything; with a
   * `domain`+`name`, removes that cookie; adding a `path` narrows further.
   */
  removeCookies(
    filter: Partial<Pick<Cookie, "domain" | "path" | "name">> = {},
  ): void {
    this._store = this._store.filter((c) => {
      if (!filter.domain) return false;
      if (c.domain !== filter.domain || c.name !== filter.name) return true;
      if (!filter.path) return false;
      return !CookieJar.pathMatches(filter.path, c.path ?? "/");
    });
  }

  /** The current, non-expired cookies. */
  toJSON(): Cookie[] {
    return this._removeExpired();
  }

  /** Creates a jar pre-seeded with the given cookies. */
  static fromCookies(cookies: Cookie[]): CookieJar {
    const jar = new CookieJar();
    jar._store = [...cookies];
    return jar;
  }
}

/**
 * Computes the default cookie path from a request path (RFC 6265 §5.1.4):
 * the directory of the request URI.
 */
function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/")) return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}
