import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import zlib from "node:zlib";

export function decodeBody(raw, contentEncoding = "", maxBytes = 2_500_000) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const enc = String(contentEncoding || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  let out = buf;
  try {
    if (enc === "gzip" || enc === "x-gzip")
      out = zlib.gunzipSync(buf, { maxOutputLength: maxBytes });
    else if (enc === "deflate")
      out = zlib.inflateSync(buf, { maxOutputLength: maxBytes });
    else if (enc === "br")
      out = zlib.brotliDecompressSync(buf, { maxOutputLength: maxBytes });
  } catch (e) {
    if (e?.code === "ERR_BUFFER_TOO_LARGE")
      throw new Error("response_too_large");
    throw new Error("invalid_content_encoding");
  }
  if (out.length > maxBytes) throw new Error("response_too_large");
  return out.toString("utf8");
}

export const USER_AGENT =
  "FinMapMonitor/1.0 (+https://map.finhot.fun/ventures/monitoring/)";
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) === 6)
    return (
      /^2[0-9a-f]{3}:/i.test(address) && !/^2001:(db8|0|2):/i.test(address)
    );
  return false;
}
export function publicUrl(raw) {
  try {
    const u = new URL(raw);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      (u.port && !["80", "443"].includes(u.port))
    )
      return null;
    if (
      u.hostname === "localhost" ||
      !u.hostname.includes(".") ||
      (isIP(u.hostname.replace(/[\[\]]/g, "")) &&
        !publicAddress(u.hostname.replace(/[\[\]]/g, "")))
    )
      return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Resolve and pin a public address for each redirect; never let source links reach private services. */
export async function fetchPublic(
  raw,
  { maxBytes = 2_500_000, timeout = 18000, headers = {}, redirects = 4 } = {},
) {
  const safe = publicUrl(raw);
  if (!safe) throw new Error("invalid_public_url");
  const url = new URL(safe),
    addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("non_public_address");
  const chosen = addresses.find((a) => a.family === 4) ?? addresses[0];
  const result = await new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        headers: {
          "user-agent": USER_AGENT,
          accept:
            "text/html, application/rss+xml, application/atom+xml, application/xml, application/json;q=0.8",
          "accept-encoding": "identity",
          ...headers,
        },
        lookup: (_hostname, options, cb) =>
          options?.all
            ? cb(null, [chosen])
            : cb(null, chosen.address, chosen.family),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new Error("response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const body = decodeBody(
              Buffer.concat(chunks),
              res.headers["content-encoding"],
              maxBytes,
            );
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body,
              url: safe,
              bytes: size,
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("timeout")), timeout);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
  if (result.status >= 300 && result.status < 400 && result.headers.location) {
    if (!redirects) throw new Error("redirect_limit");
    return fetchPublic(new URL(result.headers.location, url).href, {
      maxBytes,
      timeout,
      headers,
      redirects: redirects - 1,
    });
  }
  if (result.status >= 400) throw new Error(`http_${result.status}`);
  return result;
}

/** robots.txt applies to HTML discovery; explicit public RSS subscriptions are not web crawling. */
export function robotsAllowed(text, url) {
  const path = new URL(url).pathname + new URL(url).search;
  let agents = [],
    rules = [],
    groups = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line
      .split("#")[0]
      .trim()
      .match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(),
      v = m[2].trim();
    if (key === "user-agent") {
      if (rules.length) {
        groups.push({ agents, rules });
        agents = [];
        rules = [];
      }
      agents.push(v.toLowerCase());
    } else if (agents.length && v)
      rules.push({ allow: key === "allow", path: v });
  }
  groups.push({ agents, rules });
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && "finmapmonitor".includes(a)),
  );
  const chosen = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes("*"));
  const matched = chosen
    .flatMap((g) => g.rules)
    .filter((r) => {
      const expr = r.path
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$/, "$");
      return new RegExp("^" + expr).test(path);
    })
    .sort(
      (a, b) =>
        b.path.length - a.path.length || Number(b.allow) - Number(a.allow),
    );
  return matched[0]?.allow ?? true;
}
