import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { directorySnapshot } from "../scripts/lib/monitor-projection.mjs";
function load(file) {
  const source = ts.transpileModule(
    fs.readFileSync(new URL("../src/lib/" + file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const c = vm.createContext({ exports: {}, URL, TextEncoder });
  vm.runInContext(source, c);
  return c.exports;
}
const query = load("monitor-query.ts"),
  backup = load("workspace-backup.ts"),
  types = load("monitor-types.ts");
const event = {
  id: "event-1",
  companyId: "wuji",
  title: "SDK v2.0",
  kind: "product",
  stage: "software-release",
  role: "subject",
  evidence: "official",
  publishedAt: "2026-10-20T00:00:00Z",
  discoveredAt: "2026-10-26T00:00:00Z",
  updatedAt: "2026-10-26T00:00:00Z",
  revision: 2,
  baseline: true,
  summary: "",
  summaryType: "title-only",
  round: null,
  amount: null,
  occurredAt: null,
  sources: [
    {
      name: "SDK",
      url: "https://github.com/wuji-technology/wuji-sdk/releases",
      publishedAt: "2026-10-20T00:00:00Z",
      material: "official-title",
    },
  ],
};
const preferences = {
  watching: ["wuji"],
  saved: [event.id],
  read: { [event.id]: 2 },
  firstVisit: "2026-10-26T00:00:00Z",
  savedEvents: { [event.id]: event },
};
const encode = (p) =>
  JSON.stringify({ format: "finmap-workspace", version: 1, preferences: p });
test("switching tracks cannot leave an invisible contradictory segment filter", () => {
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        query.reconcileFilters(
          { track: "space", segment: "robot-parts/hands" },
          "track",
        ),
      ),
    ),
    { track: "space", segment: "" },
  );
  assert.equal(
    query.reconcileFilters(
      { track: "", segment: "robot-parts/hands" },
      "segment",
    ).track,
    "robot-parts",
  );
});
test("published and first-discovered sorts never promote baseline dates", () => {
  const undated = {
    ...event,
    id: "unknown",
    publishedAt: null,
    dateLabel: "2026-06",
    discoveredAt: "2026-10-28T00:00:00Z",
  };
  const fresh = { ...event, id: "new", baseline: false };
  assert.equal(query.sortEvents([undated, event])[0].id, event.id);
  assert.equal(query.sortEvents([undated, fresh], "discovered")[0].id, "new");
  assert.match(query.eventDateLabel(undated), /2026-06/);
  assert.equal(query.eventTimestamp(event), "2026-10-20（按日显示）");
  assert.match(query.eventTimestamp(undated), /仅有历史时间范围/);
});
test("backup roundtrip and merge preserve newer reading revisions and saved metadata", () => {
  const parsed = backup.parseBackup(backup.createBackup(preferences));
  const merged = backup.mergeBackup(
    { ...preferences, watching: ["xynova"], read: { [event.id]: 3 } },
    parsed,
  );
  assert.equal(merged.read[event.id], 3);
  assert.equal(merged.savedEvents[event.id].title, event.title);
  assert.deepEqual([...merged.watching], ["xynova", "wuji"]);
});
test("malformed or executable backup links are rejected before writing preferences", () => {
  assert.throws(() => backup.parseBackup("{}"));
  assert.throws(() =>
    backup.parseBackup(encode({ ...preferences, watching: ["__proto__"] })),
  );
  assert.throws(() =>
    backup.parseBackup(
      encode({
        ...preferences,
        savedEvents: {
          [event.id]: { ...event, sources: [{ url: "javascript:alert(1)" }] },
        },
      }),
    ),
  );
  assert.throws(() =>
    backup.parseBackup("x".repeat(backup.MAX_BACKUP_BYTES + 1)),
  );
});
test("a long-running workspace can export and restore more than 500 saves and 20,000 read records", () => {
  const savedEvents = Object.fromEntries(
    Array.from({ length: 750 }, (_, i) => {
      const id = `event-${i}`;
      return [id, { ...event, id, title: `舞肌科技 · SDK 公开版本 ${i}` }];
    }),
  );
  const p = {
    ...preferences,
    saved: Object.keys(savedEvents),
    savedEvents,
    read: Object.fromEntries(
      Array.from({ length: 21_000 }, (_, i) => [`read-${i}`, 1]),
    ),
  };
  const restored = backup.parseBackup(backup.createBackup(p));
  assert.equal(restored.saved.length, 750);
  assert.equal(Object.keys(restored.read).length, 21_000);
  assert.equal(
    restored.savedEvents["event-749"].title,
    savedEvents["event-749"].title,
  );
  assert.throws(() => backup.createBackup({ ...p, saved: ["invalid/id"] }));
});
test("directory projection includes latest dated subject per company only", () => {
  const snapshot = {
    events: [
      event,
      { ...event, id: "new", publishedAt: "2026-10-27T00:00:00Z" },
      { ...event, id: "unknown", publishedAt: null },
      {
        ...event,
        id: "market",
        role: "market-context",
        publishedAt: "2026-10-28T00:00:00Z",
      },
    ],
  };
  assert.deepEqual(
    directorySnapshot(snapshot).events.map((e) => e.id),
    ["new"],
  );
  assert.equal(snapshot.events.length, 4);
});

test("investor actions stay visible and retain financing type through backups", () => {
  const investing = {
    ...event,
    role: "investor",
    kind: "funding",
    financingType: "loan",
  };
  assert.equal(types.isCompanyEvent(investing), true);
  assert.equal(types.eventKindLabel(investing), "对外投资");
  assert.equal(types.isCompanyEvent({ ...event, role: "mentioned" }), false);
  assert.equal(directorySnapshot({ events: [investing] }).events.length, 1);
  const p = backup.parseBackup(
    backup.createBackup({
      ...preferences,
      savedEvents: { [event.id]: investing },
    }),
  );
  assert.equal(p.savedEvents[event.id].financingType, "loan");
});
