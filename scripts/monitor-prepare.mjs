import fs from "node:fs";
import {
  getVentures,
  getTracks,
  getMemberships,
  validateVentures,
} from "../src/lib/ventures.ts";
import { canonical, hash } from "./lib/monitor-core.mjs";

validateVentures();
const overrides = JSON.parse(
  fs.readFileSync("data/monitor/source-overrides.json", "utf8"),
);
const companies = getVentures().map((v) => {
  const extra = overrides[v.id] ?? {};
  const match = [
    ...new Set(
      [
        ...(v.match ?? [v.name, v.en, ...(v.aliases ?? [])]),
        ...(extra.aliases ?? []),
      ].filter(Boolean),
    ),
  ];
  const sources = [];
  const priority = extra.priority ?? v.track === "robot-parts";
  if (!extra.disabledReason) {
    const names = [v.name, v.en]
      .filter(Boolean)
      .map((s) => s.replace(/["()（）]/g, " ").trim());
    const ambiguous =
      /^(Ultra|Sunday|Lambda|Odyssey|Decart|Figure AI|1X Technologies|Horizon|Intuitive|Modal|WHOOP)$/i.test(
        v.name,
      );
    const query =
      "(" +
      [...new Set(names)].map((n) => `"${n}"`).join(" OR ") +
      ")" +
      (ambiguous ? " (robotics OR AI OR company)" : "") +
      (v.id === "schunk"
        ? " (gripper OR robotics OR automation OR 雄克)"
        : "") +
      " when:90d";
    const u = new URL("https://news.google.com/rss/search");
    u.searchParams.set("q", query);
    u.searchParams.set("hl", v.region === "cn" ? "zh-CN" : "en-US");
    u.searchParams.set("gl", v.region === "cn" ? "CN" : "US");
    u.searchParams.set("ceid", v.region === "cn" ? "CN:zh-Hans" : "US:en");
    sources.push({
      id: `${v.id}:search`,
      kind: "search",
      name: "公司定向新闻检索",
      url: u.href,
      intervalHours: priority ? 1 : 6,
      scope: "公开新闻索引，非全网或社交平台完整覆盖",
    });
  }
  const website = extra.website ?? v.website;
  if (website)
    sources.push({
      id: `${v.id}:official`,
      kind: "page",
      name: "公司官网与新闻入口",
      url: website,
      intervalHours: priority ? 1 : 6,
      evidence: extra.evidence ?? v.sources?.[0]?.url ?? website,
    });
  for (const s of extra.sources ?? [])
    sources.push({
      id: `${v.id}:${s.key}`,
      kind: s.kind,
      name: s.name,
      url: s.url,
      product: s.product,
      intervalHours: priority ? 1 : 6,
      evidence: s.url,
    });
  for (const s of sources)
    if (!canonical(s.url)) throw new Error(`Invalid monitor source ${s.id}`);
  return {
    id: v.id,
    name: v.name,
    en: v.en ?? "",
    region: v.region,
    memberships: getMemberships(v),
    match,
    priority,
    sources,
    channels: extra.channels ?? [],
    gaps: [
      ...(!website ? ["官网渠道尚未核验"] : []),
      "公众号与社交平台尚未形成完整自动覆盖",
      ...(extra.disabledReason ? [extra.disabledReason] : []),
    ],
    disabledReason: extra.disabledReason ?? null,
  };
});
const reviewed = [];
for (const v of getVentures())
  for (const e of v.events) {
    const kind =
      { model: "product", deployment: "partnership", ipo: "funding" }[e.kind] ??
      e.kind;
    reviewed.push({
      id: hash(v.id + "|reviewed|" + e.date + "|" + e.title),
      companyId: v.id,
      title: e.title,
      kind,
      stage: "historical",
      role: "subject",
      evidence: "reviewed",
      publishedAt: e.date.length === 10 ? e.date + "T00:00:00Z" : null,
      dateLabel: e.date,
      occurredAt: e.date,
      discoveredAt: null,
      updatedAt: null,
      revision: 1,
      baseline: true,
      summary: "",
      summaryType: "title-only",
      round: null,
      amount: e.amount ? `${e.amount.value}${e.amount.unit}` : null,
      status: e.status,
      sources: e.sources.map((s) => ({
        name: s.title,
        url: s.url,
        publishedAt: s.date ?? null,
        material: "reviewed-public-record",
      })),
    });
  }
const registry = {
  version: 1,
  companies,
  tracks: getTracks().map((t) => ({
    id: t.id,
    name: t.name,
    segments: t.segments.map((s) => ({ id: s.id, name: s.name })),
  })),
  reviewed,
};
fs.writeFileSync("data/monitor/registry.json", JSON.stringify(registry));
fs.writeFileSync("public/data/monitor-registry.json", JSON.stringify(registry));
console.log(
  `Monitor registry: ${companies.length} companies, ${companies.reduce((n, c) => n + c.sources.length, 0)} sources, ${reviewed.length} historical records.`,
);
