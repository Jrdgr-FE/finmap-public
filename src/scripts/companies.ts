import { escape, initial, hue, icon, captureActionFocus } from "../lib/ui";
import { preferences, toggleWatch } from "../lib/preferences";
import type { MonitorEvent, MonitorSnapshot } from "../lib/monitor-types";
import { isCompanyEvent } from "../lib/monitor-types";
import { sortEvents } from "../lib/monitor-query";
interface Row {
  id: string;
  name: string;
  en: string;
  intro: string;
  country: string;
  region: string;
  tags: string[];
  aliases: string[];
  memberships: { track: string; segment: string }[];
  trackName: string;
  segmentName: string;
  latest: MonitorEvent | null;
}
const app = document.querySelector<HTMLElement>("[data-company-library]");
if (app) {
  const rows = JSON.parse(
      app.querySelector("[data-company-data]")!.textContent!,
    ) as Row[],
    form = app.querySelector<HTMLFormElement>("[data-company-filters]")!;
  const url = new URL(location.href),
    state = {
      q: url.searchParams.get("q") ?? "",
      track: url.searchParams.get("track") ?? "",
      region: url.searchParams.get("region") ?? "",
      watched: url.searchParams.get("watched") === "1",
      page: 1,
    };
  let filtered: Row[] = [];
  const size = 30;
  function controls() {
    for (const k of ["q", "track", "region"] as const)
      (form.elements.namedItem(k) as HTMLInputElement).value = state[k];
  }
  function updateUrl() {
    const u = new URL(location.href);
    for (const k of ["q", "track", "region"] as const)
      state[k] ? u.searchParams.set(k, state[k]) : u.searchParams.delete(k);
    state.watched
      ? u.searchParams.set("watched", "1")
      : u.searchParams.delete("watched");
    history.replaceState(null, "", u);
  }
  function render() {
    const restoreFocus = captureActionFocus(app!);
    const p = preferences();
    filtered = rows
      .filter(
        (c) =>
          (!state.track ||
            c.memberships.some((m) => m.track === state.track)) &&
          (!state.region || c.region === state.region) &&
          (!state.watched || p.watching.includes(c.id)) &&
          (!state.q ||
            (
              c.name +
              " " +
              c.en +
              " " +
              c.intro +
              " " +
              c.aliases.join(" ") +
              " " +
              c.tags.join(" ")
            )
              .toLowerCase()
              .includes(state.q.toLowerCase())),
      )
      .sort(
        (a, b) =>
          (Date.parse(b.latest?.publishedAt ?? "") || 0) -
            (Date.parse(a.latest?.publishedAt ?? "") || 0) ||
          a.name.localeCompare(b.name, "zh-CN"),
      );
    state.page = Math.min(
      state.page,
      Math.max(1, Math.ceil(filtered.length / size)),
    );
    app!.querySelector("[data-company-rows]")!.innerHTML = filtered
      .slice((state.page - 1) * size, state.page * size)
      .map(
        (c) =>
          `<tr><td><a class="company-identity" href="/venture/${escape(c.id)}/"><span class="entity-avatar" data-hue="${hue(c.id)}">${escape(initial(c.name))}</span><span><strong>${escape(c.name)}</strong><small>${escape(c.en)}</small></span></a><p>${escape(c.intro)}</p></td><td><span>${escape(c.trackName)}</span><small>${escape(c.segmentName)}</small></td><td>${escape(c.country)}</td><td><a href="/?company=${escape(c.id)}&days=0">${escape(c.latest?.title ?? "暂无已收录动态")}</a><small>${escape(c.latest?.publishedAt?.slice(0, 10) ?? "查看公司时间线 →")}</small></td><td><button data-library-watch="${escape(c.id)}" aria-pressed="${p.watching.includes(c.id)}" aria-label="${p.watching.includes(c.id) ? "取消关注" : "关注"}${escape(c.name)}" title="${p.watching.includes(c.id) ? "取消关注" : "关注公司"}">${icon(p.watching.includes(c.id) ? "check" : "plus")}</button></td></tr>`,
      )
      .join("");
    app!.querySelector("[data-company-count]")!.textContent =
      filtered.length + " 家公司" + (state.watched ? " · 我的关注" : "");
    app!.querySelector("[data-watched-total]")!.textContent = String(
      p.watching.length,
    );
    app!
      .querySelector("[data-only-watched]")!
      .setAttribute("aria-pressed", String(state.watched));
    app!.querySelector<HTMLElement>("[data-library-empty]")!.hidden =
      !!filtered.length;
    app!.querySelector("[data-library-page]")!.textContent = filtered.length
      ? `${(state.page - 1) * size + 1}–${Math.min(state.page * size, filtered.length)} / ${filtered.length}`
      : "0 家公司";
    app!.querySelector<HTMLButtonElement>("[data-library-prev]")!.disabled =
      state.page <= 1;
    app!.querySelector<HTMLButtonElement>("[data-library-next]")!.disabled =
      state.page * size >= filtered.length;
    restoreFocus();
  }
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("input", () => {
    const data = new FormData(form);
    for (const k of ["q", "track", "region"] as const)
      state[k] = String(data.get(k) ?? "");
    state.page = 1;
    updateUrl();
    render();
  });
  app.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!t) return;
    if (t.dataset.libraryWatch) {
      toggleWatch(t.dataset.libraryWatch);
      return;
    }
    if (t.hasAttribute("data-only-watched")) {
      state.watched = !state.watched;
      state.page = 1;
      updateUrl();
      render();
      return;
    }
    if (t.hasAttribute("data-library-reset")) {
      Object.assign(state, {
        q: "",
        track: "",
        region: "",
        watched: false,
        page: 1,
      });
      controls();
      updateUrl();
      render();
      return;
    }
    if (t.hasAttribute("data-export-companies")) {
      const cell = (s: string) =>
        '"' + s.replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"', '""') + '"';
      const csv =
        "\ufeff" +
        [
          ["公司", "英文名", "地区", "赛道", "产业环节", "公司档案"],
          ...filtered.map((c) => [
            c.name,
            c.en,
            c.country,
            c.trackName,
            c.segmentName,
            "https://map.finhot.fun/venture/" + c.id + "/",
          ]),
        ]
          .map((r) => r.map(cell).join(","))
          .join("\r\n");
      const link = document.createElement("a"),
        u = URL.createObjectURL(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
        );
      link.href = u;
      link.download =
        "finmap-companies-" + new Date().toISOString().slice(0, 10) + ".csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
      return;
    }
    if (t.hasAttribute("data-library-prev") && state.page > 1) state.page--;
    else if (
      t.hasAttribute("data-library-next") &&
      state.page * size < filtered.length
    )
      state.page++;
    else return;
    render();
    app!
      .querySelector(".library-result")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  window.addEventListener("finmap:preferences", (e) => {
    render();
    if (!(e as CustomEvent).detail?.persisted)
      app!.querySelector("[data-library-status]")!.textContent =
        "当前浏览器无法保存设置；本页仍可使用，离开后可能丢失。";
  });
  window.addEventListener("storage", render);
  controls();
  render();
  void (async () => {
    try {
      const r = await fetch("/api/monitor?view=directory", {
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw Error();
      const s = (await r.json()) as MonitorSnapshot;
      if (s.version !== 1 || !Array.isArray(s.events)) throw Error();
      const latest = new Map<string, MonitorEvent>();
      for (const e of sortEvents(s.events))
        if (isCompanyEvent(e) && e.publishedAt && !latest.has(e.companyId))
          latest.set(e.companyId, e);
      for (const c of rows) c.latest = latest.get(c.id) ?? null;
      render();
      app!.querySelector("[data-library-status]")!.textContent =
        "动态索引更新于 " +
        (s.generatedAt?.slice(0, 16).replace("T", " ") ?? "未知") +
        " UTC" +
        (r.headers.get("x-monitor-fallback") ? " · 当前为发布时快照" : "") +
        "。关注状态仅保存在当前浏览器。";
    } catch {
      app!.querySelector("[data-library-status]")!.textContent =
        "实时索引暂不可用，当前显示发布时资料；公司档案和关注功能仍可使用。";
    }
  })();
}
