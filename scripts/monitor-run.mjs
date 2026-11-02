import fs from "node:fs";
import path from "node:path";
import { fetchPublic, robotsAllowed } from "./lib/monitor-fetch.mjs";
import {
  parseFeed,
  parsePage,
  isArticleUrl,
  pageIsReadable,
  canonical,
  makeEvent,
  mergeEvents,
  sourceState,
  sourceDue,
  eventClassification,
  hash,
} from "./lib/monitor-core.mjs";
import { validateRegistry, validateSnapshot } from "./lib/monitor-validate.mjs";
import { directorySnapshot } from "./lib/monitor-projection.mjs";

const argv = process.argv.slice(2),
  arg = (k, f) => {
    const i = argv.indexOf(k);
    return i < 0 ? f : argv[i + 1];
  };
const root = path.resolve(arg("--state", ".cache/monitor"));
const read = (p, f) =>
  fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : f;
const write = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p + ".tmp", JSON.stringify(v), { mode: 0o600 });
  fs.renameSync(p + ".tmp", p);
};
let registry = validateRegistry(
  read(arg("--registry", "data/monitor/registry.json")),
);
// A deployed public registry updates company membership without a server redeploy. Never load private files.
if (argv.includes("--remote-registry")) {
  try {
    const remote = await fetchPublic(
      "https://map.finhot.fun/data/monitor-registry.json",
    );
    registry = validateRegistry(JSON.parse(remote.body));
    write(path.join(root, "registry.json"), registry);
  } catch {
    registry = validateRegistry(
      read(path.join(root, "registry.json"), registry),
    );
    console.warn(
      "Published registry unavailable; using last verified registry.",
    );
  }
}
const statePath = path.join(root, "state.json"),
  outPath = arg("--output", path.join(root, "public/monitor.json"));
fs.mkdirSync(root, { recursive: true });
const lockPath = path.join(root, "run.lock");
if (fs.existsSync(lockPath)) {
  const oldPid = Number(fs.readFileSync(lockPath, "utf8"));
  try {
    if (oldPid > 0) process.kill(oldPid, 0);
    else throw new Error("stale");
    console.error("Monitor already running.");
    process.exit(2);
  } catch (e) {
    if (e.code === "ESRCH" || e.message === "stale") fs.unlinkSync(lockPath);
    else throw e;
  }
}
const lock = fs.openSync(lockPath, "wx", 0o600);
fs.writeFileSync(lock, String(process.pid));
const now = new Date().toISOString(),
  start = Date.now(),
  cutoff = Date.now() - 90 * 86400000;
const state = read(statePath, {
  version: 1,
  sources: {},
  events: [],
  pageFingerprints: {},
  discoveredChannels: {},
  lastRun: null,
});
if (state.classifierVersion !== 7) {
  for (const e of state.events) {
    const c = registry.companies.find((c) => c.id === e.companyId),
      source = c?.sources.find((s) => e.sources.some((v) => v.id === s.id));
    if (source && e.stage !== "page-change") {
      const next = eventClassification(e.title, source, c);
      if (
        Object.entries(next).some(
          ([key, value]) => (e[key] ?? null) !== (value ?? null),
        )
      ) {
        Object.assign(e, next, { updatedAt: now, revision: e.revision + 1 });
      }
    }
  }
  state.classifierVersion = 7;
}
const oldRun = state.lastRun;
let bytes = 0,
  requests = 0,
  processed = 0,
  failed = 0;
const robotCache = new Map();
async function trackedFetch(url, options) {
  requests++;
  const r = await fetchPublic(url, options);
  bytes += r.bytes;
  return r;
}
async function get(url, { html = false } = {}) {
  if (html) {
    const origin = new URL(url).origin;
    if (!robotCache.has(origin))
      robotCache.set(
        origin,
        (async () => {
          try {
            return (
              await trackedFetch(origin + "/robots.txt", {
                maxBytes: 200000,
                timeout: 12000,
              })
            ).body;
          } catch (e) {
            if (e.message === "http_404") return "";
            throw new Error("robots_unavailable");
          }
        })(),
      );
    const robots = await robotCache.get(origin);
    if (!robotsAllowed(robots, url)) throw new Error("robots_disallowed");
  }
  return trackedFetch(url);
}
function sameHost(a, b) {
  return (
    new URL(a).hostname.replace(/^www\./, "") ===
    new URL(b).hostname.replace(/^www\./, "")
  );
}
async function pageItems(source, company) {
  const response = await get(source.url, { html: true });
  if (!sameHost(source.url, response.url))
    throw new Error("unverified_domain_redirect");
  const page = parsePage(response.body, response.url, now);
  if (!pageIsReadable(page)) throw new Error("page_not_readable");
  const rows = [];
  // Baseline pages without a publication date are source checks, not invented product launches.
  if (page.article && page.publishedAt)
    rows.push({
      title: page.title,
      url: canonical(response.url),
      publishedAt: page.publishedAt,
      material: "official-page",
      excerpt: page.excerpt,
    });
  const hubs = page.links
    .filter(
      (l) =>
        sameHost(l.url, response.url) &&
        l.url !== response.url &&
        !l.publishedAt &&
        l.title.length < 22,
    )
    .slice(0, 2);
  const links = [...page.links];
  for (const hub of hubs) {
    try {
      const h = await get(hub.url, { html: true });
      if (!sameHost(h.url, response.url)) continue;
      links.push(...parsePage(h.body, h.url, now).links);
    } catch {}
  }
  const candidates = [
    ...new Map(
      links
        .filter(
          (l) =>
            sameHost(l.url, response.url) &&
            canonical(l.url) !== canonical(response.url) &&
            ((l.title.length >= 12 && l.publishedAt) || isArticleUrl(l.url)),
        )
        .map((l) => [l.url, l]),
    ).values(),
  ].slice(0, 6);
  for (const link of candidates) {
    try {
      const r = await get(link.url, { html: true });
      if (!sameHost(r.url, response.url)) continue;
      const p = parsePage(r.body, r.url, now);
      const publishedAt = p.publishedAt ?? link.publishedAt;
      if (
        publishedAt &&
        pageIsReadable(p) &&
        Date.parse(publishedAt) >= cutoff &&
        p.title.length > 8
      )
        rows.push({
          title: p.title,
          url: canonical(r.url),
          publishedAt,
          material: "official-page",
          excerpt: p.excerpt,
        });
    } catch {}
  }
  // Discover feeds only on the verified company host; social links are recorded, not claimed as monitored.
  for (const feed of page.feeds
    .filter((u) => sameHost(u, response.url))
    .slice(0, 1)) {
    try {
      rows.push(
        ...parseFeed((await get(feed)).body, { ...source, kind: "feed" }, now),
      );
    } catch {}
  }
  const old = state.sources[source.id];
  if (
    old?.fingerprint &&
    old.pageUrl === canonical(response.url) &&
    old.fingerprint !== page.fingerprint &&
    rows.length === 0
  ) {
    rows.push({
      title: `${company.name}官网内容有变化（待核对）`,
      url: canonical(response.url) + "?finmap_change=" + page.fingerprint,
      publishedAt: null,
      material: "page-change",
      change: true,
    });
  }
  return {
    rows,
    fingerprint: page.fingerprint,
    pageUrl: canonical(response.url),
  };
}
const only = arg("--company", "").split(",").filter(Boolean),
  force = argv.includes("--force");
const tasks = registry.companies
  .filter((c) => !only.length || only.includes(c.id))
  .flatMap((c) => c.sources.map((source) => ({ company: c, source })))
  .filter(
    ({ source }) =>
      force ||
      sourceDue(state.sources[source.id]?.lastAttemptAt, source.intervalHours),
  );
let cursor = 0;
async function work() {
  while (cursor < tasks.length && Date.now() - start < 20 * 60 * 1000) {
    const { company, source } = tasks[cursor++];
    try {
      const result =
        source.kind === "page"
          ? await pageItems(source, company)
          : { rows: parseFeed((await get(source.url)).body, source, now) };
      const rows = result.rows
        .filter((r) => !r.publishedAt || Date.parse(r.publishedAt) >= cutoff)
        .slice(0, 80);
      const previousUrls = new Set(
        state.events
          .filter((e) => e.companyId === company.id)
          .flatMap((e) => e.sources.map((s) => canonical(s.url))),
      );
      const seen = state.sources[source.id]?.seen ?? {};
      const checkedAt = new Date().toISOString();
      const baseline =
        !state.sources[source.id]?.lastSuccessAt ||
        !state.sources[source.id]?.seen;
      const incoming = rows.map((r) => {
        const firstSeen = seen[hash(r.url)];
        const e = makeEvent(r, source, company, firstSeen ?? checkedAt, {
          baseline: baseline || Boolean(firstSeen),
        });
        if (r.change) {
          e.kind = "other";
          e.stage = "page-change";
          e.sources[0].url = canonical(source.url);
          e.sources[0].contentHash = result.fingerprint;
        }
        return e;
      });
      state.events = mergeEvents(state.events, incoming, checkedAt);
      const newCount = baseline
        ? 0
        : rows.filter(
            (r) => !seen[hash(r.url)] && !previousUrls.has(canonical(r.url)),
          ).length;
      for (const r of rows) seen[hash(r.url)] ??= checkedAt;
      state.sources[source.id] = {
        ...sourceState(
          state.sources[source.id],
          {
            count: rows.length,
            newCount,
            fingerprint: result.fingerprint,
            pageUrl: result.pageUrl,
          },
          checkedAt,
        ),
        seen: Object.fromEntries(
          Object.entries(seen)
            .sort((a, b) => b[1].localeCompare(a[1]))
            .slice(0, 500),
        ),
      };
    } catch (e) {
      failed++;
      state.sources[source.id] = sourceState(
        state.sources[source.id],
        { error: String(e.message).slice(0, 100) },
        new Date().toISOString(),
      );
    }
    processed++;
    if (processed % 20 === 0) {
      write(statePath, state);
      console.log(
        `Checked ${processed}/${tasks.length} sources; failures=${failed}`,
      );
    }
  }
}
try {
  await Promise.all(
    Array.from({ length: Math.min(3, tasks.length) }, () => work()),
  );
  state.lastRun = {
    startedAt: now,
    finishedAt: new Date().toISOString(),
    processed,
    failed,
    pending: tasks.length - processed,
    requests,
    bytes,
    durationMs: Date.now() - start,
    modelRequests: 0,
    paidSearchRequests: 0,
  };
  state.reviewedSeen ??= {};
  for (const e of registry.reviewed)
    state.reviewedSeen[e.id] ??= oldRun?.startedAt ?? now;
  write(statePath, state);
  const companyIds = new Set(registry.companies.map((c) => c.id));
  const events = mergeEvents(
    registry.reviewed.map((e) => ({
      ...e,
      discoveredAt: e.discoveredAt ?? state.reviewedSeen[e.id],
      updatedAt: e.updatedAt ?? state.reviewedSeen[e.id],
    })),
    state.events.filter((e) => companyIds.has(e.companyId)),
    now,
  );
  const companies = registry.companies.map((c) => ({
    id: c.id,
    name: c.name,
    en: c.en,
    region: c.region,
    memberships: c.memberships,
    priority: c.priority,
    gaps: c.gaps,
    channels: c.channels,
    sources: c.sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      url: s.url,
      intervalHours: s.intervalHours,
      scope: s.scope,
      ...publicState(state.sources[s.id]),
    })),
  }));
  const snapshot = {
    version: 1,
    generatedAt: state.lastRun.finishedAt,
    lastRun: state.lastRun,
    previousRunAt: oldRun?.finishedAt ?? null,
    retentionDays: 365,
    retentionLimit: 5000,
    retentionPolicy:
      "Per-company minimum history, then subject events before incidental search matches.",
    backfillDays: 90,
    backfillComplete: false,
    companies,
    tracks: registry.tracks,
    events,
  };
  validateSnapshot(snapshot);
  write(outPath, snapshot);
  fs.chmodSync(outPath, 0o644);
  const directoryPath = path.join(path.dirname(outPath), "directory.json");
  write(directoryPath, directorySnapshot(snapshot));
  fs.chmodSync(directoryPath, 0o644);
  const companyDirectory = path.join(path.dirname(outPath), "company");
  fs.mkdirSync(companyDirectory, { recursive: true, mode: 0o755 });
  fs.chmodSync(companyDirectory, 0o755);
  for (const company of companies) {
    const filename = path.join(companyDirectory, company.id + ".json");
    write(filename, {
      ...snapshot,
      companies: [company],
      events: events.filter((e) => e.companyId === company.id),
    });
    fs.chmodSync(filename, 0o644);
  }
  console.log(
    JSON.stringify({
      companies: companies.length,
      events: events.length,
      subjectEvents: events.filter((e) => e.role === "subject").length,
      wuji: events.filter((e) => e.companyId === "wuji").length,
      ...state.lastRun,
    }),
  );
} finally {
  fs.closeSync(lock);
  fs.unlinkSync(path.join(root, "run.lock"));
}
function publicState(s) {
  if (!s)
    return {
      status: "pending",
      lastAttemptAt: null,
      lastSuccessAt: null,
      count: 0,
    };
  return {
    status: s.status,
    lastAttemptAt: s.lastAttemptAt,
    lastSuccessAt: s.lastSuccessAt ?? null,
    count: s.count ?? 0,
    newCount: s.newCount ?? 0,
    error: s.error ?? null,
    consecutiveFailures: s.consecutiveFailures ?? 0,
  };
}
