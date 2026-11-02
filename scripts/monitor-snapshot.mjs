import fs from "node:fs";
import { validateSnapshot } from "./lib/monitor-validate.mjs";
import { directorySnapshot } from "./lib/monitor-projection.mjs";
const filename = "public/data/company-monitor.json";
try {
  const res = await fetch(
    "https://monitor.example.com/finmap/monitor.json",
    { signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 6_000_000) throw new Error("oversized_snapshot");
  const snapshot = validateSnapshot(JSON.parse(text));
  fs.writeFileSync(filename, JSON.stringify(snapshot));
  console.log(
    `Monitor fallback: ${snapshot.events.length} events, generated ${snapshot.generatedAt}`,
  );
} catch (e) {
  if (!fs.existsSync(filename)) throw e;
  validateSnapshot(JSON.parse(fs.readFileSync(filename, "utf8")));
  console.warn("Using previous monitor fallback:", e.message);
}
const snapshot = JSON.parse(fs.readFileSync(filename, "utf8"));
fs.writeFileSync(
  "public/data/monitor-directory.json",
  JSON.stringify(directorySnapshot(snapshot)),
);
fs.mkdirSync("public/data/monitor-companies", { recursive: true });
for (const company of snapshot.companies)
  fs.writeFileSync(
    `public/data/monitor-companies/${company.id}.json`,
    JSON.stringify({
      ...snapshot,
      companies: [company],
      events: snapshot.events.filter((e) => e.companyId === company.id),
    }),
  );
