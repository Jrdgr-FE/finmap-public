import { publicUrl } from "./monitor-fetch.mjs";
export function validateRegistry(value) {
  if (
    value?.version !== 1 ||
    !Array.isArray(value.companies) ||
    value.companies.length < 1 ||
    value.companies.length > 1000 ||
    !Array.isArray(value.tracks) ||
    !Array.isArray(value.reviewed)
  )
    throw new Error("invalid_registry");
  const ids = new Set(),
    sourceIds = new Set();
  for (const c of value.companies) {
    if (
      !/^[a-z0-9-]{1,100}$/.test(c.id) ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !Array.isArray(c.sources) ||
      c.sources.length > 12 ||
      !Array.isArray(c.match) ||
      !Array.isArray(c.memberships)
    )
      throw new Error("invalid_company");
    ids.add(c.id);
    for (const s of c.sources) {
      if (
        sourceIds.has(s.id) ||
        !["page", "search", "feed", "release"].includes(s.kind) ||
        !publicUrl(s.url) ||
        !Number.isFinite(s.intervalHours) ||
        s.intervalHours < 1 ||
        s.intervalHours > 168
      )
        throw new Error("invalid_source");
      sourceIds.add(s.id);
    }
  }
  for (const e of value.reviewed)
    if (
      !ids.has(e.companyId) ||
      !Array.isArray(e.sources) ||
      e.sources.some((s) => !publicUrl(s.url))
    )
      throw new Error("invalid_reviewed_event");
  return value;
}
export function validateSnapshot(value) {
  if (
    value?.version !== 1 ||
    !Array.isArray(value.companies) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.tracks) ||
    !Number.isFinite(Date.parse(value.generatedAt))
  )
    throw new Error("invalid_snapshot");
  const ids = new Set(value.companies.map((c) => c.id));
  for (const e of value.events)
    if (
      !ids.has(e.companyId) ||
      typeof e.title !== "string" ||
      !Array.isArray(e.sources) ||
      e.sources.length < 1 ||
      e.sources.some((s) => !publicUrl(s.url))
    )
      throw new Error("invalid_event");
  return value;
}
