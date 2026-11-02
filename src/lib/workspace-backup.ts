import type { Preferences } from "./preferences";
import type { MonitorEvent } from "./monitor-types";

export const MAX_BACKUP_BYTES = 20_000_000;
const MAX_RECORDS = 100_000;
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(v);
const ids = (v: unknown, max: number) => {
  if (!Array.isArray(v) || v.length > max || v.some((x) => !id(x)))
    throw Error("备份中的记录标识无效或数量过多。");
  return [...new Set(v)] as string[];
};
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
export function parseBackup(text: string): Preferences {
  if (
    text.length > MAX_BACKUP_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES
  )
    throw Error("备份超过 20 MB，暂时无法导入；现有记录没有改变。");
  const raw = JSON.parse(text);
  if (
    raw?.format !== "finmap-workspace" ||
    raw.version !== 1 ||
    !raw.preferences
  )
    throw Error("这不是 FinMap 工作台备份。");
  const p = raw.preferences;
  const result: Preferences = {
    watching: ids(p.watching, MAX_RECORDS),
    saved: ids(p.saved, MAX_RECORDS),
    read: {},
    firstVisit: date(p.firstVisit) ? p.firstVisit : new Date().toISOString(),
    dismissed: ids(p.dismissed ?? [], MAX_RECORDS),
    savedEvents: {},
  };
  if (
    !p.read ||
    typeof p.read !== "object" ||
    Array.isArray(p.read) ||
    Object.keys(p.read).length > MAX_RECORDS
  )
    throw Error("阅读记录格式不正确。");
  for (const [key, value] of Object.entries(p.read))
    if (id(key) && Number.isSafeInteger(value) && Number(value) >= 0)
      result.read[key] = Number(value);
  if (date(p.lastVisit)) result.lastVisit = p.lastVisit;
  for (const key of result.saved) {
    const e = p.savedEvents?.[key];
    if (!e) continue;
    if (
      e.id !== key ||
      !id(e.companyId) ||
      typeof e.title !== "string" ||
      e.title.length > 1000 ||
      !Array.isArray(e.sources) ||
      e.sources.length > 50 ||
      !date(e.discoveredAt) ||
      !date(e.updatedAt) ||
      (e.publishedAt !== null && !date(e.publishedAt)) ||
      !Number.isSafeInteger(e.revision) ||
      e.revision < 1
    )
      throw Error("收藏记录格式不正确。");
    const sources = e.sources.map((s: Record<string, unknown>) => {
      const url = new URL(String(s.url));
      if (!/^https?:$/.test(url.protocol) || url.username || url.password)
        throw Error("备份含无效的原文链接。");
      return {
        name: String(s.name ?? "").slice(0, 160),
        url: url.href,
        publishedAt: date(s.publishedAt) ? String(s.publishedAt) : null,
        material: String(s.material ?? "").slice(0, 80),
      };
    });
    result.savedEvents![key] = {
      id: key,
      companyId: e.companyId,
      title: e.title,
      sources,
      publishedAt: e.publishedAt,
      discoveredAt: e.discoveredAt,
      updatedAt: e.updatedAt,
      revision: e.revision,
      occurredAt:
        typeof e.occurredAt === "string" ? e.occurredAt.slice(0, 60) : null,
      dateLabel:
        typeof e.dateLabel === "string" ? e.dateLabel.slice(0, 60) : undefined,
      kind: String(e.kind ?? "other").slice(0, 40),
      stage: String(e.stage ?? "reported").slice(0, 40),
      role: String(e.role ?? "subject").slice(0, 40),
      evidence: String(e.evidence ?? "discovery").slice(0, 40),
      summary: String(e.summary ?? "").slice(0, 1000),
      summaryType: String(e.summaryType ?? "title-only").slice(0, 40),
      baseline: !!e.baseline,
      round: typeof e.round === "string" ? e.round.slice(0, 100) : null,
      amount: typeof e.amount === "string" ? e.amount.slice(0, 100) : null,
      financingType:
        typeof e.financingType === "string"
          ? e.financingType.slice(0, 40)
          : null,
    } satisfies MonitorEvent;
  }
  return result;
}

/** Validate the same contract before offering a download, so exports remain importable. */
export function createBackup(preferences: Preferences): string {
  const text = JSON.stringify({
    format: "finmap-workspace",
    version: 1,
    exportedAt: new Date().toISOString(),
    preferences,
  });
  parseBackup(text);
  return text;
}

export function mergeBackup(
  current: Preferences,
  incoming: Preferences,
): Preferences {
  const read = { ...current.read };
  for (const [key, revision] of Object.entries(incoming.read))
    read[key] = Math.max(read[key] ?? 0, revision);
  const savedEvents = { ...incoming.savedEvents, ...current.savedEvents };
  for (const [key, e] of Object.entries(incoming.savedEvents ?? {}))
    if (!savedEvents[key] || e.revision > savedEvents[key].revision)
      savedEvents[key] = e;
  return {
    ...current,
    read,
    saved: [...new Set([...current.saved, ...incoming.saved])],
    watching: [...new Set([...current.watching, ...incoming.watching])],
    dismissed: [
      ...new Set([...(current.dismissed ?? []), ...(incoming.dismissed ?? [])]),
    ],
    savedEvents,
  };
}
