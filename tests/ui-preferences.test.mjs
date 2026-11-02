import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/lib/preferences.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function fixture(initial = null) {
  let stored = initial === null ? null : JSON.stringify(initial);
  let blocked = false;
  const events = [];
  const context = vm.createContext({
    structuredClone,
    exports: {},
    localStorage: {
      getItem: () => stored,
      setItem: (_key, value) => {
        if (blocked) throw new Error("QuotaExceeded");
        stored = value;
      },
    },
    CustomEvent: class {
      constructor(type, data) {
        this.type = type;
        this.detail = data.detail;
      }
    },
    window: { dispatchEvent: (event) => events.push(event) },
  });
  vm.runInContext(source, context);
  return {
    api: context.exports,
    events,
    stored: () => JSON.parse(stored),
    block: (value) => {
      blocked = value;
    },
    replace: (value) => {
      stored = JSON.stringify(value);
    },
  };
}

const existing = {
  read: { sdk: 2 },
  saved: ["sdk"],
  watching: ["wuji"],
  firstVisit: "2026-10-23T00:00:00Z",
};

test("existing reading revisions and saved events survive company follow changes", () => {
  const f = fixture(existing);
  f.api.toggleWatch("xynova");
  assert.deepEqual(f.stored(), { ...existing, watching: ["wuji", "xynova"] });
  f.api.toggleWatch("wuji");
  assert.deepEqual(f.stored().watching, ["xynova"]);
  assert.equal(f.events.at(-1).detail.persisted, true);
});

test("failed storage writes keep new page state instead of reloading stale preferences", () => {
  const f = fixture(existing);
  f.block(true);
  f.api.toggleWatch("xynova");
  assert.equal(f.api.preferences().watching.includes("xynova"), true);
  assert.deepEqual(f.stored().watching, ["wuji"]);
  assert.equal(f.events.at(-1).detail.persisted, false);
  f.block(false);
  f.api.toggleWatch("wuji");
  assert.deepEqual(f.stored().watching, ["xynova"]);
  assert.equal(f.stored().read.sdk, 2);
});

test("another tab’s persisted changes are read without resetting reading history", () => {
  const f = fixture(existing);
  f.api.preferences();
  f.replace({ ...existing, watching: ["brainco"], read: { sdk: 3 } });
  assert.equal(f.api.preferences().watching[0], "brainco");
  assert.equal(f.api.preferences().read.sdk, 3);
});
test("saved public metadata survives removal from the public snapshot and can be un-saved", () => {
  const f = fixture(existing);
  const event = { id: "kept", companyId: "wuji", title: "SDK", revision: 1 };
  f.api.toggleSaved(event);
  assert.equal(
    f.api.withSavedEvents([]).find((e) => e.id === "kept").title,
    "SDK",
  );
  f.api.cacheSavedEvents([{ ...event, title: "SDK corrected", revision: 2 }]);
  assert.equal(f.api.withSavedEvents([])[0].revision, 2);
  f.api.toggleSaved(event);
  assert.equal(f.api.withSavedEvents([]).length, 0);
  assert.equal(f.stored().read.sdk, 2);
});
