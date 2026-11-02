import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost } from "../functions/api/monitor.js";
import {
  validateRegistry,
  validateSnapshot,
} from "../scripts/lib/monitor-validate.mjs";

test("edge read uses one fixed origin, ignores query destinations, and caches the stream", async () => {
  const originalFetch = globalThis.fetch,
    originalCaches = globalThis.caches;
  const calls = [],
    cache = new Map();
  globalThis.caches = {
    default: {
      match: async (k) => cache.get(k.url)?.clone(),
      put: async (k, r) => cache.set(k.url, r),
    },
  };
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response('{"version":1,"events":[]}', {
      headers: { "content-type": "application/json", "x-monitor-schema": "1" },
    });
  };
  try {
    const jobs = [];
    const context = {
      request: new Request(
        "https://map.finhot.fun/api/monitor?url=http://127.0.0.1",
      ),
      env: {},
      waitUntil: (p) => jobs.push(p),
    };
    const first = await onRequestGet(context);
    assert.equal(first.status, 200);
    await jobs[0];
    await onRequestGet({
      ...context,
      request: new Request("https://map.finhot.fun/api/monitor?random=2"),
    });
    assert.deepEqual(calls, [
      "https://monitor.example.com/finmap/monitor.json",
    ]);
    assert.equal(cache.size, 1);
    assert.equal(first.headers.get("x-content-type-options"), "nosniff");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});
test("origin failure returns an explicitly labelled static fallback and refuses writes", async () => {
  const originalFetch = globalThis.fetch,
    originalCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => null } };
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    const r = await onRequestGet({
      request: new Request("https://map.finhot.fun/api/monitor"),
      env: { ASSETS: { fetch: async () => new Response('{"version":1}') } },
      waitUntil: () => {},
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-monitor-fallback"), "build-snapshot");
    assert.equal(onRequestPost().status, 405);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});
test("company reads use a fixed partition, reject path traversal, and keep the same fallback scope", async () => {
  const originalFetch = globalThis.fetch,
    originalCaches = globalThis.caches;
  const calls = [],
    assets = [];
  globalThis.caches = { default: { match: async () => null } };
  globalThis.fetch = async (url) => {
    calls.push(url);
    throw new Error("offline");
  };
  const context = (company) => ({
    request: new Request(
      "https://map.finhot.fun/api/monitor?company=" +
        encodeURIComponent(company),
    ),
    env: {
      ASSETS: {
        fetch: async (url) => {
          assets.push(String(url));
          return new Response('{"version":1}');
        },
      },
    },
    waitUntil() {},
  });
  try {
    assert.equal((await onRequestGet(context("../state"))).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await onRequestGet(context("wuji"))).status, 200);
    assert.deepEqual(calls, [
      "https://monitor.example.com/finmap/company/wuji.json",
    ]);
    assert.deepEqual(assets, [
      "https://map.finhot.fun/data/monitor-companies/wuji.json",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});
test("registry and public snapshot reject private URLs and unknown companies", () => {
  assert.throws(() =>
    validateRegistry({
      version: 1,
      companies: [
        {
          id: "a",
          name: "A",
          match: ["A"],
          memberships: [],
          sources: [
            {
              id: "a:1",
              kind: "page",
              url: "http://127.0.0.1/admin",
              intervalHours: 1,
            },
          ],
        },
      ],
      tracks: [],
      reviewed: [],
    }),
  );
  assert.throws(() =>
    validateSnapshot({
      version: 1,
      generatedAt: "2026-10-26T00:00:00Z",
      companies: [],
      tracks: [],
      events: [{ companyId: "unknown", title: "test", sources: [] }],
    }),
  );
});
test("directory projection uses its own fixed cache and same-scope fallback", async () => {
  const oldFetch = globalThis.fetch,
    oldCaches = globalThis.caches,
    urls = [],
    assets = [];
  globalThis.caches = { default: { match: async () => null } };
  globalThis.fetch = async (url) => {
    urls.push(url);
    throw Error("offline");
  };
  try {
    const response = await onRequestGet({
      request: new Request(
        "https://map.finhot.fun/api/monitor?view=directory&url=https://evil.invalid",
      ),
      env: {
        ASSETS: {
          fetch: async (url) => {
            assets.push(String(url));
            return new Response('{"version":1}');
          },
        },
      },
      waitUntil() {},
    });
    assert.equal(response.headers.get("x-monitor-fallback"), "build-snapshot");
    assert.deepEqual(urls, [
      "https://monitor.example.com/finmap/directory.json",
    ]);
    assert.deepEqual(assets, [
      "https://map.finhot.fun/data/monitor-directory.json",
    ]);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.caches = oldCaches;
  }
});
