# knifetch

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/knifetch?color=yellow)](https://npmjs.com/package/knifetch)
[![npm downloads](https://img.shields.io/npm/dm/knifetch?color=yellow)](https://npm.chart.dev/knifetch)

<!-- /automd -->

knifetch is a customized fetch function with enhanced features.

## Usage

Install package:

<!-- automd:pm-install -->

```sh
# ✨ Auto-detect
npx nypm install knifetch

# npm
npm install knifetch

# yarn
yarn add knifetch

# pnpm
pnpm add knifetch

# bun
bun install knifetch

# deno
deno install npm:knifetch
```

<!-- /automd -->

Import:

<!-- automd:jsimport cjs cdn name="knifetch" imports="knifetch,createKnifetch" -->

**ESM** (Node.js, Bun, Deno)

```js
import { knifetch, createKnifetch } from "knifetch";
```

**CommonJS** (Legacy Node.js)

```js
const { knifetch, createKnifetch } = require("knifetch");
```

**CDN** (Deno and Browsers)

```js
import { knifetch, createKnifetch } from "https://esm.sh/knifetch";
```

<!-- /automd -->

## Quick start

Use the default `knifetch` instance, or build a configured client with
`createKnifetch`:

```js
import { knifetch, createKnifetch } from "knifetch";

// default instance — returns a Response
const res = await knifetch("https://api.example.com/users");
const users = await res.json();

// configured client that parses JSON and prefixes a base URL
const api = createKnifetch({
  baseURL: "https://api.example.com",
  transformResponse: (res) => res.json(),
});

const user = await api("/users/1");
```

## Request options

`knifetch(input, init)` accepts everything the native `fetch` does, plus a few
convenience fields on `init`:

```js
await knifetch("https://api.example.com/search", {
  // appended to the URL; null/undefined values are skipped
  query: { q: "hello", page: 2 },

  // JSON body — sets `Content-Type: application/json` and method POST
  json: { name: "Ada" },

  // urlencoded body — `application/x-www-form-urlencoded`
  form: { a: "1", b: 2 },

  // multipart body — `multipart/form-data`
  formData: { file: new Blob(["hi"]), name: "note" },

  // see "Retry" below
  retry: true,
});
```

When a body helper (`json` / `form` / `formData`) is provided and no `method`
is set, the method defaults to `POST`.

## Errors

By default, responses with a non-2xx status reject with an `HttpError`
(matching [ky](https://github.com/sindresorhus/ky)). The error carries the
`Response` so you can inspect it:

```js
import { HttpError } from "knifetch";

try {
  await knifetch("https://api.example.com/missing");
} catch (error) {
  if (error instanceof HttpError) {
    console.log(error.status); // e.g. 404
    console.log(await error.response.text());
  }
}
```

Set `throwHttpErrors: false` to always resolve with the raw `Response`:

```js
const client = createKnifetch({ throwHttpErrors: false });
const res = await client("https://api.example.com/missing");
res.ok; // false
```

## Retry

Retrying is HTTP-aware. By default it only retries **idempotent** methods
(`GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS`, `TRACE`), retries on transient
status codes (`408, 409, 425, 429, 500, 502, 503, 504`) and network errors, and
honors the `Retry-After` header. Backoff is exponential with full jitter.

```js
// enable with defaults (3 retries)
await knifetch("https://api.example.com/data", { retry: true });

// shorthand: number of retries
await knifetch("https://api.example.com/data", { retry: 5 });

// full control
await knifetch("https://api.example.com/data", {
  retry: {
    retries: 5,
    factor: 2, // exponential base
    minTimeout: 1000, // ms
    maxTimeout: 30_000, // ms
    jitter: true,
    timeout: 10_000, // per-attempt timeout; aborts the in-flight request
    methods: ["GET", "POST"], // opt POST into retrying
    statusCodes: [429, 503], // override retryable codes
    shouldRetry: ({ error, attempt, retriesLeft }) => true,
    onFailedAttempt: ({ error, attempt }) => console.warn("retry", attempt),
  },
});
```

Pass an `AbortSignal` via `init.signal` to cancel the whole operation
(including any pending retries and the in-flight request).

## Interceptors

`createKnifetch` supports a middleware pipeline. Each hook may return a
replacement object; interceptors re-run on every retry attempt.

```js
const client = createKnifetch({
  onRequest({ request }) {
    request.headers.set("authorization", `Bearer ${getToken()}`);
    return request; // optional
  },
  onResponse({ request, response }) {
    // inspect or replace the response
  },
  onFetchError({ request, error }) {
    // return a Response to recover, or nothing to rethrow
  },
  transformResponse(response) {
    return response.json(); // becomes the resolved value
  },
});
```

## Cookies

Enable a server-side cookie jar with `cookieJar`. Stored cookies are attached
to matching requests automatically:

```js
import { CookieJar } from "knifetch";

const jar = new CookieJar();
const client = createKnifetch({ cookieJar: jar });
// or: createKnifetch({ cookieJar: true }) to use an internal jar
```

## Development

<details>

<summary>local development</summary>

- Clone this repository
- Install latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

</details>

## License

<!-- automd:contributors license=MIT -->

Published under the [MIT](https://github.com/YieldRay/knifetch/blob/main/LICENSE) license.
Made by [community](https://github.com/YieldRay/knifetch/graphs/contributors) 💛
<br><br>
<a href="https://github.com/YieldRay/knifetch/graphs/contributors">
<img src="https://contrib.rocks/image?repo=YieldRay/knifetch" />
</a>

<!-- /automd -->

<!-- automd:with-automd -->

---

_🤖 auto updated with [automd](https://automd.unjs.io)_

<!-- /automd -->
