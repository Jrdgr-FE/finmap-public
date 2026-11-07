import type {
  MonitorSnapshot,
  MonitorEvent,
  MonitorCompany,
  MonitorSource,
} from "../lib/monitor-types";
import {
  MONITOR_KINDS,
  MONITOR_EVIDENCE,
  MONITOR_STAGE,
  MONITOR_FINANCING,
  isCompanyEvent,
  eventKindLabel,
  fundingRoundLabel,
} from "../lib/monitor-types";
import {
  escape,
  safeHref,
  when,
  initial,
  hue,
  icon,
  captureActionFocus,
} from "../lib/ui";
import {
  preferences,
  savePreferences,
  toggleWatch,
  toggleSaved,
  toggleDismissed,
  withSavedEvents,
  cacheSavedEvents,
} from "../lib/preferences";
import {
  reconcileFilters,
  sortEvents,
  eventDateLabel,
  eventTimestamp,
} from "../lib/monitor-query";

for (const app of document.querySelectorAll<HTMLElement>("[data-monitor]")) {
  let snapshot = JSON.parse(
    app.querySelector("[data-monitor-data]")!.textContent!,
  ) as MonitorSnapshot;
  const fixedCompany = app.dataset.company ?? "",
    coverage = app.dataset.coverage === "true";
  const initialEvents = Array.isArray(snapshot.events) ? [...snapshot.events] : [];
  let supplementalLoaded = fixedCompany !== "";
  let supplementalEvents: MonitorEvent[] = [...initialEvents];
  function mergeSupplemental(next: MonitorSnapshot): MonitorSnapshot {
    if (!supplementalEvents.length) return next;
    const existingIds = new Set(next.events.map((e) => e.id));
    const existingUrls = new Set(
      next.events.flatMap((e) => (e.sources ?? []).map((s) => s.url).filter(Boolean)),
    );
    const added: MonitorEvent[] = [];
    for (const ev of supplementalEvents) {
      if (fixedCompany && ev.companyId !== fixedCompany) continue;
      if (existingIds.has(ev.id)) continue;
      const primaryUrl = ev.sources?.[0]?.url;
      if (primaryUrl && existingUrls.has(primaryUrl)) continue;
      existingIds.add(ev.id);
      if (primaryUrl) existingUrls.add(primaryUrl);
      added.push(ev);
    }
    if (!added.length) return next;
    const mergedEvents = sortEvents([...next.events, ...added]);
    return { ...next, events: mergedEvents };
  }
  const form = app.querySelector<HTMLFormElement>("[data-filters]");
  const dialog = app.querySelector<HTMLDialogElement>(".event-drawer")!;
  const desktopReader = matchMedia("(min-width: 1101px)");
  let prefs = preferences(),
    selectedId = "",
    visible: MonitorEvent[] = [],
    total = 0,
    refreshing = false,
    loadFailed = false,
    lastRefresh = 0;
  const params = new URLSearchParams(location.search);
  const previousVisit = prefs.lastVisit ?? prefs.firstVisit;
  const state = {
    q: params.get("q") ?? "",
    track: params.get("track") ?? "",
    segment: params.get("segment") ?? "",
    region: params.get("region") ?? "",
    company: fixedCompany || params.get("company") || "",
    days: ["0", "1", "7", "30", "90"].includes(params.get("days") ?? "")
      ? params.get("days")!
      : params.get("scope") === "saved" ||
          params.get("q") ||
          params.get("company")
        ? "0"
        : "7",
    kind: params.get("kind") ?? "",
    scope: ["watching", "saved", "unread", "new", "dismissed"].includes(
      params.get("scope") ?? "",
    )
      ? params.get("scope")!
      : "all",
    related: params.get("related") === "1",
    evidence: ["official", "discovery", "reviewed"].includes(
      params.get("evidence") ?? "",
    )
      ? params.get("evidence")!
      : "",
    health: params.get("health") ?? "",
    signal:
      params.get("signal") === "all" ||
      ["saved", "dismissed"].includes(params.get("scope") ?? "")
        ? "all"
        : "key",
    order: params.get("order") === "discovered" ? "discovered" : "published",
    page: 1,
  };
  const size = fixedCompany ? 8 : coverage ? 15 : 25;
  const companyIndex = () => new Map(snapshot.companies.map((c) => [c.id, c]));
  const trackName = (id: string) =>
    snapshot.tracks.find((t) => t.id === id)?.name ?? id;
  const dateLabel = (date: string | null) =>
    date
      ? new Date(date).toLocaleDateString("zh-CN", {
          month: "short",
          day: "numeric",
        })
      : "日期未披露";
  const companyMatches = (c: MonitorCompany) =>
    !!c &&
    (!state.company || c.id === state.company) &&
    (!state.region || c.region === state.region) &&
    (!state.track || c.memberships.some((m) => m.track === state.track)) &&
    (!state.segment ||
      c.memberships.some((m) => m.track + "/" + m.segment === state.segment));
  function syncControls() {
    reconcileFilters(state);
    if (form)
      for (const [k, v] of Object.entries(state)) {
        const input = form.elements.namedItem(k) as HTMLInputElement | null;
        if (input) input.value = String(v);
      }
    const related = app.querySelector<HTMLInputElement>(
      "[data-include-related]",
    );
    if (related) related.checked = state.related;
    const order = app.querySelector<HTMLSelectElement>("[data-order]");
    if (order) order.value = state.order;
    const segmentSelect = form?.elements.namedItem(
      "segment",
    ) as HTMLSelectElement | null;
    if (segmentSelect)
      for (const option of segmentSelect.options) {
        option.hidden = !!(
          state.track &&
          option.value &&
          !option.value.startsWith(state.track + "/")
        );
        option.disabled = option.hidden;
      }
  }
  function updateUrl() {
    if (fixedCompany) return;
    const u = new URL(location.href);
    for (const k of [
      "q",
      "track",
      "segment",
      "region",
      "company",
      "days",
      "kind",
      "scope",
      "evidence",
      "health",
      "signal",
      "order",
    ] as const) {
      if (
        state[k] &&
        !(k === "days" && state[k] === (state.scope === "saved" ? "0" : "7")) &&
        !(k === "scope" && state[k] === "all") &&
        !(k === "order" && state[k] === "published") &&
        !(k === "signal" && state[k] === "key")
      )
        u.searchParams.set(k, state[k]);
      else u.searchParams.delete(k);
    }
    if (state.related) u.searchParams.set("related", "1");
    else u.searchParams.delete("related");
    history.replaceState(null, "", u);
    window.dispatchEvent(new Event("finmap:scope"));
  }
  function reset() {
    Object.assign(state, {
      q: "",
      track: "",
      segment: "",
      region: "",
      company: fixedCompany,
      days: state.scope === "saved" ? "0" : "7",
      kind: "",
      related: false,
      evidence: "",
      health: "",
      signal:
        state.scope === "saved" || state.scope === "dismissed" ? "all" : "key",
      order: "published",
      page: 1,
    });
    syncControls();
    updateUrl();
    render();
  }
  function baseEvents() {
    const index = companyIndex();
    return withSavedEvents(snapshot.events, prefs).filter((e) => {
      const c = index.get(e.companyId);
      return (
        c &&
        companyMatches(c) &&
        (!state.evidence || e.evidence === state.evidence) &&
        (fixedCompany ||
          state.scope === "saved" ||
          state.scope === "dismissed" ||
          state.signal === "all" ||
          e.kind !== "other") &&
        (state.scope === "dismissed" ||
          state.scope === "saved" ||
          !prefs.dismissed?.includes(e.id)) &&
        (state.related ||
          state.scope === "saved" ||
          state.scope === "dismissed" ||
          isCompanyEvent(e)) &&
        (fixedCompany ||
          state.days === "0" ||
          (e.publishedAt &&
            Date.parse(e.publishedAt) >=
              Date.now() - Number(state.days) * 86400000)) &&
        (!state.q ||
          (c.name + " " + c.en + " " + e.title + " " + e.summary)
            .toLowerCase()
            .includes(state.q.toLowerCase()))
      );
    });
  }
  function scopeMatch(e: MonitorEvent, scope = state.scope) {
    return scope === "watching"
      ? prefs.watching.includes(e.companyId)
      : scope === "saved"
        ? prefs.saved.includes(e.id)
        : scope === "unread"
          ? (prefs.read[e.id] ?? 0) < e.revision
          : scope === "new"
            ? !e.baseline &&
              Date.parse(e.discoveredAt) > Date.parse(previousVisit)
            : scope === "dismissed"
              ? !!prefs.dismissed?.includes(e.id)
              : true;
  }
  function eventHtml(e: MonitorEvent, index: Map<string, MonitorCompany>) {
    const c = index.get(e.companyId);
    if (!c) return "";
    const read = (prefs.read[e.id] ?? 0) >= e.revision,
      saved = prefs.saved.includes(e.id);
    return `<article class="monitor-event" data-event="${escape(e.id)}" data-read="${read}">${!read ? '<i class="event-unread" aria-label="未读"></i>' : ""}<a href="/venture/${escape(c.id)}/" class="entity-avatar" data-hue="${hue(c.id)}" aria-label="${escape(c.name)}公司档案">${escape(initial(c.name))}</a><div class="event-content"><div class="event-meta"><a href="/venture/${escape(c.id)}/">${escape(c.name)}</a><span class="monitor-tag" data-type="${escape(e.kind)}">${escape(eventKindLabel(e))}</span>${e.revision > 1 ? '<span class="event-revision">有补充</span>' : ""}<time datetime="${escape(e.publishedAt ?? "")}">${escape(eventDateLabel(e))}</time></div><h3><button class="event-title" data-open-detail="${escape(e.id)}">${escape(e.title)}</button></h3><div class="event-byline"><span class="evidence-label">${e.evidence === "official" ? icon("check") : ""}${escape(MONITOR_EVIDENCE[e.evidence] ?? "公开线索")}</span><span class="publisher-label">${escape(e.sources[0]?.name)}</span>${e.sources.length > 1 ? `<span>${e.sources.length} 个出处</span>` : ""}<div class="event-actions"><button data-read-event="${escape(e.id)}" aria-pressed="${read}" aria-label="${read ? "标为未读" : "标为已读"}" title="${read ? "标为未读" : "标为已读"}">${icon("check")}</button><button data-save="${escape(e.id)}" aria-pressed="${saved}" aria-label="${saved ? "取消收藏" : "收藏动态"}" title="${saved ? "取消收藏" : "收藏动态"}">${icon("bookmark")}</button><button data-open-detail="${escape(e.id)}" aria-label="查看动态详情" title="查看动态详情">${icon("arrow")}</button></div></div></div></article>`;
  }
  function renderDetail() {
    const e = withSavedEvents(snapshot.events, prefs).find(
      (e) => e.id === selectedId,
    );
    if (!e) return;
    const c = companyIndex().get(e.companyId);
    if (!c) return;
    const saved = prefs.saved.includes(e.id),
      watched = prefs.watching.includes(c.id);
    const position = visible.findIndex((item) => item.id === e.id);
    app.querySelector<HTMLButtonElement>("[data-reader-prev]")!.disabled =
      position <= 0;
    app.querySelector<HTMLButtonElement>("[data-reader-next]")!.disabled =
      position < 0 || position >= visible.length - 1;
    app.querySelector("[data-event-detail]")!.innerHTML =
      `<div class="drawer-content"><div class="drawer-company"><a class="entity-avatar" data-hue="${hue(c.id)}" href="/venture/${escape(c.id)}/">${escape(initial(c.name))}</a><a href="/venture/${escape(c.id)}/">${escape(c.name)}</a><a href="/venture/${escape(c.id)}/">公司档案 ↗</a></div><div class="drawer-classification"><span class="monitor-tag" data-type="${escape(e.kind)}">${escape(eventKindLabel(e))}</span><span>${escape(MONITOR_STAGE[e.stage] ?? "公开线索")}</span><span>${escape(eventDateLabel(e))}</span></div><h2>${escape(e.title)}</h2>${e.kind === "funding" && (e.round || e.amount || e.financingType) ? `<dl class="event-facts"><div><dt>事项 · 标题提取</dt><dd>${escape(MONITOR_FINANCING[e.financingType ?? ""] ?? "融资并购")}${e.role === "investor" ? " · 对外投资" : ""}</dd></div><div><dt>轮次 · 标题提取</dt><dd>${escape(fundingRoundLabel(e.round))}</dd></div><div><dt>金额 · 标题提取</dt><dd>${escape(e.amount ?? "未披露")}</dd></div></dl>` : ""}${e.summary ? `<section class="drawer-section source-excerpt"><h3>${e.summaryType === "source-excerpt" ? "来源摘录" : "已保存说明"}</h3><p>${escape(e.summary)}</p></section>` : ""}<div class="drawer-note">${e.evidence === "discovery" ? "这是一条新闻检索线索，目前依据索引标题归类，尚未核验全文。请打开原文确认融资阶段、产品状态和具体口径。" : e.evidence === "official" ? "来自已核验的公司官方渠道。标题与发布时间保留来源表述，性能或商业化主张仍需结合原文核对。" : "这是已有公开资料的历史整理，请结合原始披露及其时点阅读。"}${e.role === "investor" || e.stage === "investor" ? " 公司在该事件中参与投资，不能将金额视作其自身融资。" : !isCompanyEvent(e) ? " 此条仅为相关报道或市场背景，未认定为该公司的主体事件。" : ""}</div><div class="drawer-actions"><a class="btn primary-action" href="${escape(safeHref(e.sources[0]?.url ?? ""))}" target="_blank" rel="noopener noreferrer">打开原文 ${icon("external")}</a><button class="btn" data-save="${escape(e.id)}" aria-pressed="${saved}">${icon("bookmark")}${saved ? "已收藏" : "收藏"}</button><button class="btn" data-watch="${escape(c.id)}" aria-pressed="${watched}">${icon(watched ? "check" : "plus")}${watched ? "已关注公司" : "关注公司"}</button><button class="btn" data-dismiss="${escape(e.id)}">${prefs.dismissed?.includes(e.id) ? "恢复显示" : "暂不关注这条"}</button></div><section class="drawer-section"><h3>信息出处 · ${e.sources.length}</h3>${e.sources.map((s) => `<a class="drawer-source" href="${escape(safeHref(s.url))}" target="_blank" rel="noopener noreferrer"><strong>${escape(s.name)}${icon("external")}</strong><small>${escape(new URL(safeHref(s.url) === "#" ? "https://example.invalid" : s.url).hostname)} · ${escape(s.publishedAt?.slice(0, 10) ?? "日期未披露")}</small></a>`).join("")}</section><section class="drawer-section"><h3>时间与记录</h3><dl class="drawer-dates"><dt>来源发布时间</dt><dd>${escape(eventTimestamp(e))}</dd><dt>首次收录</dt><dd>${escape(when(e.discoveredAt))}${e.baseline ? " · 历史回填" : ""}</dd><dt>最近补充</dt><dd>${escape(when(e.updatedAt))} · 版本 ${e.revision}</dd><dt>事件发生时间</dt><dd>${escape(e.occurredAt ?? "未单独核验")}</dd></dl></section></div>`;
  }
  function presentReader() {
    const mode =
      !fixedCompany && !coverage && desktopReader.matches ? "docked" : "modal";
    if (dialog.open && dialog.dataset.presentation !== mode) dialog.close();
    dialog.dataset.presentation = mode;
    app.classList.toggle("reader-open", mode === "docked");
    if (!dialog.open) {
      if (mode === "docked") dialog.show();
      else dialog.showModal();
    }
  }
  desktopReader.addEventListener("change", () => {
    if (dialog.open) presentReader();
  });
  function openDetail(id: string) {
    selectedId = id;
    const e = withSavedEvents(snapshot.events, prefs).find((e) => e.id === id);
    if (!e) return;
    prefs = preferences();
    prefs.read[id] = e.revision;
    savePreferences(prefs);
    renderDetail();
    presentReader();
    app.querySelectorAll<HTMLElement>("[data-event]").forEach((row) => {
      row.dataset.selected = String(row.dataset.event === id);
      if (row.dataset.event === id && dialog.dataset.presentation === "docked")
        row.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    const u = new URL(location.href);
    u.searchParams.set("event", id);
    history.replaceState(null, "", u);
  }
  function health(s: MonitorSource) {
    if (!s.lastAttemptAt) return "pending";
    if (s.status === "error") return "error";
    if (
      !s.lastSuccessAt ||
      Date.now() - Date.parse(s.lastSuccessAt) >
        Math.max(2, s.intervalHours * 2) * 3600000
    )
      return "stale";
    return s.status;
  }
  function healthLabel(s: MonitorSource) {
    return (
      (
        {
          pending: "等待首次检查",
          error: "获取失败",
          stale: "检查已过期",
          new: "发现新增",
          ok: s.count ? "检查成功" : "检查成功 · 无条目",
        } as Record<string, string>
      )[health(s)] ?? "待检查"
    );
  }
  function companyHtml(c: MonitorCompany) {
    const succeeded = c.sources.filter((s) =>
      ["ok", "new"].includes(health(s)),
    ).length;
    const watched = prefs.watching.includes(c.id);
    const errors: Record<string, string> = {
      robots_disallowed: "来源禁止自动抓取",
      robots_unavailable: "来源抓取规则暂不可用",
      page_not_readable: "页面需动态渲染或访问受限",
      unverified_domain_redirect: "跳转到未核验域名",
      non_public_address: "域名解析未通过检查",
      timeout: "请求超时",
      not_a_feed: "订阅返回格式异常",
    };
    return `<article class="monitor-company"><div class="monitor-company-head"><a href="/venture/${escape(c.id)}/">${escape(c.name)}</a><span>${c.region === "cn" ? "国内" : "海外"} · ${succeeded}/${c.sources.length} 个渠道检查有效</span><div class="monitor-company-actions"><button type="button" data-watch="${escape(c.id)}" aria-pressed="${watched}">${watched ? "已关注" : "关注公司"}</button><a href="/ventures/updates/?company=${escape(c.id)}&days=0">查看动态 →</a></div></div><p class="monitor-company-gaps">${escape(c.gaps.join(" · "))}</p>${c.sources.map((s) => `<div class="monitor-source-row"><a href="${escape(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">${escape(s.name)} ↗</a><span class="monitor-health" data-health="${health(s)}">${escape(healthLabel(s))}</span><time>最近尝试 ${escape(when(s.lastAttemptAt))}<br>最近成功 ${escape(when(s.lastSuccessAt))}</time><small>${s.intervalHours} 小时检查${s.error ? ` · ${escape(errors[s.error] ?? (s.error.startsWith("http_") ? "来源返回 " + s.error.slice(5) : "来源暂不可用"))}` : ` · 本轮返回 ${s.count ?? 0} 条`}</small></div>`).join("")}${c.channels.map((s) => `<div class="monitor-source-row"><a href="${escape(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">${escape(s.name)} ↗</a><span class="monitor-health" data-health="pending">手动查看入口</span><small>账号已核验，自动采集尚未接入</small></div>`).join("")}</article>`;
  }
  function renderContext(base: MonitorEvent[]) {
    if (fixedCompany || coverage) return;
    const index = companyIndex(),
      watched = snapshot.companies.filter((c) => prefs.watching.includes(c.id));
    const values: Record<string, number> = {
      events: base.length,
      funding: base.filter((e) => e.kind === "funding").length,
      product: base.filter((e) => ["product", "research"].includes(e.kind))
        .length,
      companies: new Set(base.map((e) => e.companyId)).size,
    };
    for (const [key, value] of Object.entries(values)) {
      const el = app.querySelector(`[data-pulse-${key}]`);
      if (el)
        el.textContent = snapshot.bootstrapPartial
          ? "—"
          : value.toLocaleString();
    }
    app.querySelector("[data-pulse-range]")!.textContent =
      (state.days === "0" ? "已收录范围" : `最近 ${state.days} 天`) +
      (state.scope === "watching" ? " · 我的关注" : "");
    const starters = app.querySelector<HTMLElement>("[data-watch-starters]");
    if (starters) starters.hidden = watched.length > 0;
    const summary = app.querySelector("[data-watch-summary]")!;
    summary.innerHTML = watched.length
      ? `<p><strong>${watched.length}</strong> 家正在关注的公司</p><div class="terminal-watch-list">${watched
          .slice(0, 7)
          .map(
            (c) =>
              `<a href="/?company=${escape(c.id)}" title="${escape(c.name)}"><span class="entity-avatar" data-hue="${hue(c.id)}">${escape(initial(c.name))}</span><span>${escape(c.name)}</span><small>${base.filter((e) => e.companyId === c.id).length} 条</small></a>`,
          )
          .join("")}</div>`
      : "<p>为你的研究建立一份关注清单。融资、产品和商业进展，集中在一处跟进。</p>";
    const counts = ["funding", "product", "partnership", "ranking"].map(
        (kind) => ({ kind, count: base.filter((e) => e.kind === kind).length }),
      ),
      max = Math.max(1, ...counts.map((x) => x.count));
    app.querySelector("[data-context-window]")!.textContent =
      state.days === "0" ? "已收录范围" : "最近 " + state.days + " 天";
    app.querySelector("[data-signal-bars]")!.innerHTML =
      snapshot.bootstrapPartial
        ? '<p class="context-loading">完整索引载入后显示</p>'
        : counts
            .map(
              (x) =>
                `<button class="signal-bar" data-bar="${x.kind}" data-set-kind="${x.kind}"><span>${MONITOR_KINDS[x.kind]}</span><span class="signal-track"><i style="width:${(x.count / max) * 100}%"></i></span><strong>${x.count}</strong></button>`,
            )
            .join("");
    const byCompany = new Map<string, number>();
    for (const e of base)
      byCompany.set(e.companyId, (byCompany.get(e.companyId) ?? 0) + 1);
    app.querySelector("[data-active-companies]")!.innerHTML =
      snapshot.bootstrapPartial
        ? '<p class="context-loading">正在整理公司动态…</p>'
        : [...byCompany]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, n]) => {
              const c = index.get(id)!;
              return `<div class="active-company"><span class="entity-avatar" data-hue="${hue(id)}">${escape(initial(c.name))}</span><button data-filter-company="${escape(id)}"><strong>${escape(c.name)}</strong><small>${escape(trackName(c.memberships[0]?.track ?? ""))}</small></button><span>${n}</span></div>`;
            })
            .join("") || '<p class="context-loading">当前范围暂无收录动态</p>';
    const sources = snapshot.companies.flatMap((c) => c.sources),
      fail = sources.filter((s) =>
        ["error", "stale"].includes(health(s)),
      ).length;
    app.querySelector("[data-context-health]")!.innerHTML =
      `<a href="/ventures/monitoring/">${icon("activity")} 监测与数据覆盖 ${icon("arrow")}</a><p>${snapshot.companies.length} 家公司在库 · ${fail} 个渠道需留意<br/>公开渠道按 1–6 小时检查。<br/>X 与公众号尚未完整自动覆盖。</p>`;
  }
  function render() {
    const restoreFocus = captureActionFocus(app);
    prefs = preferences();
    const index = companyIndex(),
      base = baseEvents(),
      kinds = state.kind.split(",").filter(Boolean),
      typed = base.filter((e) => !kinds.length || kinds.includes(e.kind));
    const list = sortEvents(
        typed.filter((e) => scopeMatch(e)),
        state.order,
      ),
      companies = snapshot.companies.filter(
        (c) =>
          companyMatches(c) &&
          (!state.health ||
            (state.health === "missing"
              ? !c.sources.some((s) => ["ok", "new"].includes(health(s)))
              : state.health === "issues"
                ? c.sources.some((s) => ["error", "stale"].includes(health(s)))
                : c.sources.length > 0 &&
                  c.sources.every((s) => ["ok", "new"].includes(health(s))))) &&
          (!state.q ||
            (c.name + " " + c.en)
              .toLowerCase()
              .includes(state.q.toLowerCase())),
      );
    total = coverage ? companies.length : list.length;
    state.page = Math.min(state.page, Math.max(1, Math.ceil(total / size)));
    visible = list.slice((state.page - 1) * size, state.page * size);
    if (coverage) {
      const sources = companies.flatMap((c) => c.sources);
      app.querySelector("[data-metrics]")!.innerHTML = [
        [companies.length, "范围内公司"],
        [
          companies.filter((c) =>
            c.sources.some((s) => ["ok", "new"].includes(health(s))),
          ).length,
          "至少一个渠道检查有效",
        ],
        [
          sources.filter((s) => ["error", "stale"].includes(health(s))).length,
          "失败或过期渠道",
        ],
      ]
        .map(
          ([n, label]) =>
            `<div><strong>${n}</strong><span>${label}</span></div>`,
        )
        .join("");
    }
    let day = "";
    app.querySelector("[data-monitor-content]")!.innerHTML = coverage
      ? companies
          .slice((state.page - 1) * size, state.page * size)
          .map(companyHtml)
          .join("")
      : visible
          .map((e) => {
            const groupDate =
              state.order === "discovered"
                ? e.baseline
                  ? null
                  : e.discoveredAt
                : e.publishedAt;
            const d = groupDate?.slice(0, 10) ?? "历史或未披露日期",
              head = d !== day;
            day = d;
            return (
              (head && !fixedCompany
                ? `<div class="event-day-label">${escape(groupDate ? dateLabel(groupDate) + (state.order === "discovered" ? " 收录" : "") : "历史或未披露日期")}<span></span></div>`
                : "") + eventHtml(e, index)
            );
          })
          .join("");
    app.querySelector("[data-result-count]")!.textContent =
      snapshot.bootstrapPartial && !coverage
        ? loadFailed
          ? "当前仅显示首屏内容 · 筛选结果可能不完整"
          : "首屏预览 · 正在加载更多动态"
        : total.toLocaleString() + (coverage ? " 家公司" : " 条动态");
    const empty = app.querySelector<HTMLElement>("[data-empty]")!;
    empty.hidden = total > 0 || !!snapshot.bootstrapPartial;
    app.querySelector("[data-empty-title]")!.textContent = coverage
      ? "没有符合条件的公司"
      : state.scope === "watching" && !prefs.watching.length
        ? "从第一家关注公司开始"
        : state.scope === "saved" && !prefs.saved.length
          ? "把值得回看的动态留下来"
          : state.scope === "new"
            ? "暂未收录本次新增动态"
            : state.scope === "dismissed"
              ? "没有暂不关注的动态"
              : "当前范围暂无已收录动态";
    app.querySelector("[data-empty-description]")!.textContent = coverage
      ? "可以清除公司或状态条件，查看其他公司的来源覆盖。"
      : state.scope === "watching" && !prefs.watching.length
        ? "前往公司库，关注你正在 mapping 的公司。之后可以集中查看它们的最新动态。"
        : state.scope === "saved" && !prefs.saved.length
          ? "在动态右侧点击收藏图标，重要报道和产品更新就能在这里找到。"
          : state.scope === "new"
            ? `自 ${when(previousVisit)} 以来首次发现的非回填内容会出现在这里；原文发布时间仍受当前时间筛选约束。`
            : "试试调整时间或筛选条件。没有收录结果，不代表公司没有新动态。";
    app.querySelector("[data-page]")!.textContent = total
      ? `${(state.page - 1) * size + 1}–${Math.min(total, state.page * size)} / ${total.toLocaleString()}`
      : snapshot.bootstrapPartial
        ? "更多动态待载入"
        : "0 条记录";
    app.querySelector<HTMLButtonElement>("[data-prev]")!.disabled =
      state.page <= 1;
    app.querySelector<HTMLButtonElement>("[data-next]")!.disabled =
      state.page * size >= total;
    for (const b of app.querySelectorAll<HTMLElement>("[data-scope]"))
      b.setAttribute("aria-pressed", String(state.scope === b.dataset.scope));
    for (const c of app.querySelectorAll<HTMLElement>("[data-scope-count]")) {
      const n = typed.filter((e) => scopeMatch(e, c.dataset.scopeCount)).length;
      c.textContent = snapshot.bootstrapPartial
        ? ""
        : n > 999
          ? "999+"
          : String(n);
    }
    for (const b of app.querySelectorAll<HTMLElement>("[data-kind]"))
      b.setAttribute("aria-pressed", String(kinds.includes(b.dataset.kind!)));
    const filters = [
      ["track", state.track ? trackName(state.track) : ""],
      [
        "segment",
        state.segment
          ? (snapshot.tracks
              .flatMap((t) =>
                t.segments.map((s) => ({
                  key: t.id + "/" + s.id,
                  name: s.name,
                })),
              )
              .find((s) => s.key === state.segment)?.name ?? state.segment)
          : "",
      ],
      ["region", state.region === "cn" ? "国内" : state.region ? "海外" : ""],
      [
        "company",
        !fixedCompany && state.company
          ? (index.get(state.company)?.name ?? state.company)
          : "",
      ],
      ["kind", kinds.map((k) => MONITOR_KINDS[k] ?? k).join("、")],
      ["q", state.q],
      ["related", state.related ? "包含相关线索" : ""],
      ["evidence", state.evidence ? MONITOR_EVIDENCE[state.evidence] : ""],
      [
        "health",
        state.health
          ? ((
              {
                issues: "来源存在异常",
                missing: "暂无有效自动渠道",
                healthy: "渠道检查有效",
              } as Record<string, string>
            )[state.health] ?? "")
          : "",
      ],
      ["scope", state.scope === "dismissed" ? "暂不关注的动态" : ""],
    ].filter(([, v]) => v);
    const chips = app.querySelector<HTMLElement>("[data-active-filters]")!;
    chips.hidden = !filters.length;
    chips.innerHTML =
      filters
        .map(
          ([k, v]) =>
            `<button data-clear-filter="${k}">${escape(v)}${icon("close")}</button>`,
        )
        .join("") +
      (filters.length ? "<button data-reset>清除筛选</button>" : "");
    const count = app.querySelector("[data-filter-count]");
    if (count) count.textContent = filters.length ? String(filters.length) : "";
    for (const b of app.querySelectorAll<HTMLElement>("[data-preset]"))
      b.setAttribute(
        "aria-pressed",
        String(
          b.dataset.preset === "hands"
            ? state.segment === "robot-parts/hands"
            : b.dataset.preset === "product"
              ? state.kind === "product,research"
              : state.kind === b.dataset.preset,
        ),
      );
    renderContext(base.filter((e) => scopeMatch(e)));
    if (dialog.open) {
      renderDetail();
      app.querySelectorAll<HTMLElement>("[data-event]").forEach((row) => {
        row.dataset.selected = String(row.dataset.event === selectedId);
      });
    }
    restoreFocus();
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    loadFailed = false;
    const notice = app.querySelector<HTMLElement>("[data-connection-notice]")!,
      message = app.querySelector<HTMLElement>("[data-connection-message]")!,
      retry = app.querySelector<HTMLButtonElement>("[data-retry]")!;
    notice.hidden = true;
    retry.disabled = true;
    const slow = window.setTimeout(() => {
      if (!snapshot.bootstrapPartial) return;
      notice.hidden = false;
      message.textContent = "连接较慢，正在继续读取。已显示的内容可以先阅读。";
    }, 5000);
    const status = app.querySelector<HTMLElement>("[data-monitor-status]")!,
      button = app.querySelector<HTMLButtonElement>("[data-refresh]");
    if (button) button.disabled = true;
    try {
      const disclosuresPromise = !supplementalLoaded
        ? fetch("/data/listed-disclosures.json", {
            signal: AbortSignal.timeout(10000),
          })
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null)
        : Promise.resolve(null);
      const r = await fetch(
        "/api/monitor" +
          (fixedCompany ? "?company=" + encodeURIComponent(fixedCompany) : ""),
        { signal: AbortSignal.timeout(fixedCompany ? 12000 : 30000) },
      );
      if (!r.ok) throw Error("unavailable");
      const [next, disclosures] = await Promise.all([
        r.json(),
        disclosuresPromise,
      ]);
      if (Array.isArray(disclosures?.events)) {
        supplementalEvents = [...initialEvents, ...disclosures.events];
        supplementalLoaded = true;
      }
      if (
        next.version !== 1 ||
        !Array.isArray(next.events) ||
        !Array.isArray(next.companies)
      )
        throw Error("invalid");
      snapshot = mergeSupplemental(next);
      notice.hidden = true;
      cacheSavedEvents(snapshot.events);
      render();
      const stale =
        !snapshot.generatedAt ||
        Date.now() - Date.parse(snapshot.generatedAt) > 8 * 3600000;
      status.dataset.stale = String(
        stale || !!r.headers.get("x-monitor-fallback"),
      );
      status.textContent = `${r.headers.get("x-monitor-fallback") ? "发布时快照" : stale ? "数据已过期" : "索引更新"} · ${when(snapshot.generatedAt)} · 时间按设备时区显示`;
    } catch {
      if (snapshot.bootstrapPartial)
        try {
          const r = await fetch("/data/company-monitor.json", {
              signal: AbortSignal.timeout(30000),
            }),
            next = r.ok ? await r.json() : null;
          if (
            next?.version === 1 &&
            Array.isArray(next.events) &&
            Array.isArray(next.companies)
          ) {
            snapshot = mergeSupplemental(next);
            render();
          }
        } catch {}
      status.dataset.stale = "true";
      status.textContent = `连接暂不可用 · 显示${snapshot.bootstrapPartial ? "首屏记录" : "已保存快照"} ${when(snapshot.generatedAt)} · 可刷新重试`;
      loadFailed = true;
      notice.hidden = false;
      message.textContent = snapshot.bootstrapPartial
        ? "暂时无法加载更多动态，当前仅有首屏内容，筛选结果可能不完整。请重新加载。"
        : "暂时无法取得最新动态，当前显示上次保存的内容。可以继续阅读，或重新加载。";
      render();
    } finally {
      window.clearTimeout(slow);
      retry.disabled = false;
      refreshing = false;
      lastRefresh = Date.now();
      if (button) button.disabled = false;
    }
  }
  form?.addEventListener("submit", (e) => e.preventDefault());
  form?.addEventListener("input", (event) => {
    const changedName = (event.target as HTMLInputElement).name;
    const data = new FormData(form);
    for (const k of [
      "q",
      "track",
      "segment",
      "region",
      "company",
      "days",
      "evidence",
      "health",
      "signal",
    ] as const)
      if (data.has(k)) state[k] = String(data.get(k));
    if (
      (changedName === "q" || changedName === "company") &&
      (state.q || state.company) &&
      state.days === "7"
    ) {
      state.days = "0";
    }
    reconcileFilters(state, changedName);
    syncControls();
    state.page = 1;
    updateUrl();
    render();
  });
  app.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button,a");
    if (!t) return;
    if (
      t.hasAttribute("data-reader-prev") ||
      t.hasAttribute("data-reader-next")
    ) {
      const position = visible.findIndex((item) => item.id === selectedId);
      const next =
        visible[position + (t.hasAttribute("data-reader-next") ? 1 : -1)];
      if (position >= 0 && next) openDetail(next.id);
      return;
    }
    if (t.hasAttribute("data-refresh") || t.hasAttribute("data-retry")) {
      void refresh();
      return;
    }
    if (t.hasAttribute("data-close-detail")) {
      dialog.close();
      return;
    }
    if (t.hasAttribute("data-toggle-filters")) {
      const box = app.querySelector<HTMLElement>("[data-filter-expanded]")!;
      box.hidden = !box.hidden;
      t.setAttribute("aria-expanded", String(!box.hidden));
      return;
    }
    if (t.hasAttribute("data-reset")) {
      reset();
      return;
    }
    if (t.dataset.openDetail) {
      openDetail(t.dataset.openDetail);
      return;
    }
    if (t.dataset.watch) {
      toggleWatch(t.dataset.watch);
      return;
    }
    if (t.dataset.dismiss) {
      toggleDismissed(t.dataset.dismiss);
      dialog.close();
      return;
    }
    if (t.hasAttribute("data-show-dismissed")) {
      state.scope = "dismissed";
      state.days = "0";
      state.signal = "all";
      state.page = 1;
      syncControls();
      updateUrl();
      render();
      return;
    }
    if (t.dataset.pulse) {
      state.kind =
        t.dataset.pulse === "all"
          ? ""
          : t.dataset.pulse === "product"
            ? "product,research"
            : "funding";
      state.page = 1;
      updateUrl();
      render();
      return;
    }
    if (t.dataset.save) {
      const ev = withSavedEvents(snapshot.events).find(
        (v) => v.id === t.dataset.save,
      );
      if (ev) toggleSaved(ev);
      return;
    }
    if (t.dataset.readEvent) {
      prefs = preferences();
      const ev = withSavedEvents(snapshot.events).find(
        (v) => v.id === t.dataset.readEvent,
      );
      if (ev) {
        prefs.read[ev.id] =
          (prefs.read[ev.id] ?? 0) >= ev.revision ? 0 : ev.revision;
        savePreferences(prefs);
      }
      return;
    }
    if (t.hasAttribute("data-mark-visible")) {
      prefs = preferences();
      for (const ev of visible) prefs.read[ev.id] = ev.revision;
      savePreferences(prefs);
      return;
    }
    if (t.dataset.scope) {
      if (state.days === (state.scope === "saved" ? "0" : "7"))
        state.days = t.dataset.scope === "saved" ? "0" : "7";
      state.scope = t.dataset.scope;
      if (state.scope === "saved" || state.scope === "dismissed")
        state.signal = "all";
      state.page = 1;
      syncControls();
      updateUrl();
      render();
      return;
    }
    if (t.dataset.clearFilter) {
      const k = t.dataset.clearFilter as keyof typeof state;
      if (k === "related") state.related = false;
      else if (k === "scope") state.scope = "all";
      else if (
        [
          "track",
          "segment",
          "region",
          "company",
          "kind",
          "q",
          "evidence",
          "health",
        ].includes(k)
      )
        (state as unknown as Record<string, unknown>)[k] = "";
      if (k === "track") state.segment = "";
      state.page = 1;
      syncControls();
      updateUrl();
      render();
      return;
    }
    if (t.dataset.filterCompany) {
      state.company = t.dataset.filterCompany;
      if (state.days === "7") state.days = "0";
      state.page = 1;
      syncControls();
      updateUrl();
      render();
      return;
    }
    if (t.dataset.preset) {
      if (t.dataset.preset === "hands") {
        state.segment =
          state.segment === "robot-parts/hands" ? "" : "robot-parts/hands";
        state.track = "";
      } else {
        const value =
          t.dataset.preset === "product"
            ? "product,research"
            : t.dataset.preset;
        state.kind = state.kind === value ? "" : value;
      }
      state.page = 1;
      syncControls();
      updateUrl();
      render();
      return;
    }
    if (t.dataset.setKind) {
      state.kind = t.dataset.setKind;
      state.page = 1;
      updateUrl();
      render();
      return;
    }
    if (t.dataset.kind !== undefined) {
      const ks = new Set(state.kind.split(",").filter(Boolean));
      ks.has(t.dataset.kind)
        ? ks.delete(t.dataset.kind)
        : ks.add(t.dataset.kind);
      state.kind = [...ks].join(",");
      state.page = 1;
      updateUrl();
      render();
      return;
    }
    if (t.hasAttribute("data-prev") && state.page > 1) state.page--;
    else if (t.hasAttribute("data-next") && state.page * size < total)
      state.page++;
    else return;
    render();
    app
      .querySelector(".monitor-result-head")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  app
    .querySelector("[data-include-related]")
    ?.addEventListener("change", (e) => {
      state.related = (e.target as HTMLInputElement).checked;
      state.page = 1;
      updateUrl();
      render();
    });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right) dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    // Switching between a docked reader and the mobile modal reopens synchronously.
    if (dialog.open) return;
    app.classList.remove("reader-open");
    app.querySelectorAll<HTMLElement>("[data-event]").forEach((row) => {
      row.dataset.selected = "false";
    });
    const u = new URL(location.href);
    u.searchParams.delete("event");
    history.replaceState(null, "", u);
    const target =
      app.querySelector<HTMLElement>(
        `[data-open-detail="${CSS.escape(selectedId)}"]`,
      ) ?? app.querySelector<HTMLElement>(".monitor-result-head");
    if (target) {
      if (!target.hasAttribute("data-open-detail")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      dialog.open &&
      dialog.dataset.presentation === "docked" &&
      !document.querySelector("dialog:modal")
    )
      dialog.close();
  });
  window.addEventListener("finmap:preferences", (e) => {
    render();
    if (!(e as CustomEvent).detail?.persisted)
      app.querySelector("[data-monitor-status]")!.textContent =
        "当前浏览器无法保存设置；本页仍可使用，离开后可能丢失。";
  });
  window.addEventListener("storage", () => render());
  app.querySelector("[data-order]")?.addEventListener("change", (e) => {
    state.order = (e.target as HTMLSelectElement).value;
    state.page = 1;
    updateUrl();
    render();
  });
  syncControls();
  render();
  void refresh().then(() => {
    const id = params.get("event");
    if (id) openDetail(id);
  });
  const refreshVisible = () => {
    if (!document.hidden && Date.now() - lastRefresh >= 5 * 60000)
      void refresh();
  };
  setInterval(refreshVisible, 5 * 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !coverage && !fixedCompany) {
      const p = preferences();
      p.lastVisit = new Date().toISOString();
      savePreferences(p);
    } else refreshVisible();
  });
  window.addEventListener("pagehide", () => {
    if (!coverage && !fixedCompany) {
      const p = preferences();
      p.lastVisit = new Date().toISOString();
      savePreferences(p);
    }
  });
}
