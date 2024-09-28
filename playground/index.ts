import { createKnifetch, type Fetch, knifetch } from "../src";

const repo = await knifetch("https://ungh.cc/repos/yieldray/knifetch", {
  query: { utm_source: "knifetch" },
}).then((res) => res.json());
console.log(repo);

const fetch: Fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const res = Response.json({
    method: req.method,
    url: req.url,
    headers: Object.fromEntries(req.headers.entries()),
    body: await req.text(),
  });
  return res;
};

const kniFetch = createKnifetch({
  fetch,
  transformResponse: (res) => res.json() as Record<string, any>,
});

const resp = await kniFetch("https://example.net", {
  json: {
    hello: "r-fetch",
  },
});

console.log(resp);
