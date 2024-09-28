import { Cookie, cookieToString, getSetCookies } from "./cookie";

export const isBrowser =
  typeof window !== "undefined" && window.document !== undefined;

/**
 * This class is for server-side only
 *
 * @note this is just a simple implementation, not strictly follow the rfc6265,
 * and some new features are missing, for example, Cookie.partitioned is not supported
 */
export class CookieJar {
  /**
   * Domain to cookie
   */
  private _store: Cookie[] = [];

  private _removeExpired() {
    this._store = this._store.filter(
      (cookie) => !(cookie.expires && Number(cookie.expires) < Date.now()),
    );
    return this._store;
  }

  setCookie(response: Response) {
    const url = new URL(response.url);
    const domain = url.hostname;
    const cookies = getSetCookies(response.headers)
      .map((cookie) => {
        // save cookie with right properties
        if (!cookie.domain) {
          cookie.domain = domain;
        }
        // https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1.2.4
        // If the server omits the Path attribute, the user
        // agent will use the "directory" of the request-uri's path component as
        // the default value.
        if (!cookie.path) {
          cookie.path = url.pathname;
        }
        return cookie;
      })
      .filter((cookie) => {
        // remove invalid cookies
        if (domain === "localhost") return true;
        if (cookie.secure && url.protocol !== "https:") return false;
        // check the domain
        if (
          !(
            cookie.domain === domain ||
            // TODO: "public suffixes" are not handled yet
            // https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1.2.3
            cookie.domain!.endsWith(`.${domain}`)
          )
        )
          return false;

        // remove expired
        if (cookie.expires && Number(cookie.expires) < Date.now()) {
          this.removeCookies(cookie);
          return false;
        }
        // TODO: for response.redirected, we may need to consider cookie.SameSite for security reason
        return true;
      });

    this._store.push(...cookies);
  }

  getCookies(input: RequestInfo | URL) {
    const url = input instanceof Request ? new URL(input.url) : new URL(input);
    const domain = url.hostname;

    const cookies = this._removeExpired().filter((cookie) => {
      return (
        (cookie.domain === domain || domain.endsWith(`.${cookie.domain}`)) &&
        (cookie.path?.endsWith("/")
          ? url.pathname.startsWith(cookie.path)
          : url.pathname === cookie.path ||
            url.pathname.startsWith(`${cookie.path}/`))
      );
      // TODO: "public suffixes" are not handled yet
      // https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1.2.3
    });

    return cookies.map((cookie) => cookieToString(cookie));
  }

  removeCookies(cookie: Partial<Pick<Cookie, "domain" | "path" | "name">>) {
    this._store = this._store.filter((c) => {
      // remove all
      if (!cookie.domain) return false;
      // remove by domain and name
      if (!cookie.path)
        return !(c.domain === cookie.domain && c.name === cookie.name);
      // remove by domain path and name
      return !(
        c.domain === cookie.domain &&
        c.name === cookie.name &&
        (cookie.path.endsWith("/")
          ? c.path?.startsWith(cookie.path)
          : c.path === cookie.path || c.path?.startsWith(`${cookie.path}/`))
      );
    });
  }

  toJSON() {
    return this._removeExpired();
  }

  static fromCookies(cookies: Cookie[]) {
    const jar = new this();
    jar._store = cookies;
    return jar;
  }
}
