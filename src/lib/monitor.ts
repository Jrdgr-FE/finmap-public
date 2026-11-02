import fs from "node:fs";
import path from "node:path";

import type { MonitorSnapshot, MonitorCompany } from "./monitor-types";
export * from "./monitor-types";
let snapshot: MonitorSnapshot | null = null;
export function getMonitorSnapshot(): MonitorSnapshot {
  if (snapshot) return snapshot;
  const p = path.join(process.cwd(), "public/data/company-monitor.json");
  if (fs.existsSync(p)) {
    snapshot = JSON.parse(fs.readFileSync(p, "utf8")) as MonitorSnapshot;
    return snapshot;
  }
  const registry = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data/monitor/registry.json"),
      "utf8",
    ),
  );
  snapshot = {
    version: 1,
    generatedAt: null,
    lastRun: null,
    backfillComplete: false,
    backfillDays: 90,
    companies: registry.companies.map((c: MonitorCompany) => ({
      ...c,
      sources: c.sources.map((s) => ({
        ...s,
        status: "pending",
        lastAttemptAt: null,
        lastSuccessAt: null,
      })),
    })),
    tracks: registry.tracks,
    events: registry.reviewed,
  };
  return snapshot!;
}
