import fs from "node:fs";
import { fetchPublic, robotsAllowed } from "./lib/monitor-fetch.mjs";
import { parsePage, pageIsReadable } from "./lib/monitor-core.mjs";

// Read-only bounded probe using the collector's actual network policy and parser.
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(input) || input.length > 60)
  throw Error("invalid_probe_list");
const output = [];
let index = 0;
async function work() {
  while (index < input.length) {
    const candidate = input[index++];
    const report = { ...candidate, checkedAt: new Date().toISOString() };
    try {
      const r = await fetchPublic(new URL("/robots.txt", candidate.url).href, {
        timeout: 12000,
        maxBytes: 200000,
      }).catch((e) => {
        if (/^http_4(?!29)\d\d$/.test(e.message)) return { body: "" };
        throw Error("robots_unavailable");
      });
      if (!robotsAllowed(r.body, candidate.url))
        throw Error("robots_disallowed");
      const response = await fetchPublic(candidate.url);
      report.finalUrl = response.url;
      report.http = response.status;
      report.contentType = response.headers["content-type"];
      const page = parsePage(response.body, response.url, report.checkedAt);
      report.title = page.title;
      report.textLength = page.text.length;
      report.publishedAt = page.publishedAt;
      if (process.argv.includes("--preview"))
        report.preview = page.text.slice(0, 1800);
      report.links = page.links.slice(0, 12);
      report.feeds = page.feeds;
      report.readable = pageIsReadable(page);
    } catch (error) {
      report.error = error.message;
    }
    output.push(report);
  }
}
await Promise.all(Array.from({ length: 3 }, work));
console.log(
  JSON.stringify(
    { checkedAt: new Date().toISOString(), results: output },
    null,
    2,
  ),
);
