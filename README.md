# knifetch

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/knifetch?color=yellow)](https://npmjs.com/package/knifetch)
[![npm downloads](https://img.shields.io/npm/dm/knifetch?color=yellow)](https://npm.chart.dev/knifetch)

<!-- /automd -->

knifetch is a customized fetch function with enhanced features.

> For production, prefer [kv](https://github.com/sindresorhus/ky) or [ofetch](https://github.com/unjs/ofetch).

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
