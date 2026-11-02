const ORIGIN = "https://monitor.example.com/finmap/";
export async function onRequestGet({ request, env, waitUntil }) {
  const company = new URL(request.url).searchParams.get("company");
  const directory =
    !company && new URL(request.url).searchParams.get("view") === "directory";
  if (company && !/^[a-z0-9-]{1,100}$/.test(company))
    return Response.json({ error: "invalid_company" }, { status: 400 });
  const keyUrl = new URL("/api/monitor", request.url);
  if (company) keyUrl.searchParams.set("company", company);
  if (directory) keyUrl.searchParams.set("view", "directory");
  const key = new Request(keyUrl.href);
  const cached = await caches.default.match(key);
  if (cached) return cached;
  try {
    const response = await fetch(
      ORIGIN +
        (company
          ? `company/${company}.json`
          : directory
            ? "directory.json"
            : "monitor.json"),
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json") ||
      response.headers.get("x-monitor-schema") !== "1"
    )
      throw new Error("unavailable");
    if (Number(response.headers.get("content-length") ?? 0) > 6_000_000)
      throw new Error("size");
    // The publisher validates the snapshot once. Stream it here to avoid parsing megabytes on every edge miss.
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
      "x-content-type-options": "nosniff",
    });
    for (const name of ["etag", "last-modified", "content-encoding"])
      if (response.headers.has(name))
        headers.set(name, response.headers.get(name));
    const result = new Response(response.body, { headers });
    waitUntil(caches.default.put(key, result.clone()));
    return result;
  } catch {
    const fallback = await env.ASSETS.fetch(
      new URL(
        company
          ? `/data/monitor-companies/${company}.json`
          : directory
            ? "/data/monitor-directory.json"
            : "/data/company-monitor.json",
        request.url,
      ),
    );
    if (!fallback.ok)
      return Response.json(
        { error: "monitor_temporarily_unavailable" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
      "x-monitor-fallback": "build-snapshot",
      "x-content-type-options": "nosniff",
    });
    if (fallback.headers.has("content-encoding"))
      headers.set("content-encoding", fallback.headers.get("content-encoding"));
    return new Response(fallback.body, { headers });
  }
}
export async function onRequestHead(context) {
  const r = await onRequestGet(context);
  return new Response(null, { status: r.status, headers: r.headers });
}
export function onRequestOptions() {
  return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
}
export function onRequestPost() {
  return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
}
