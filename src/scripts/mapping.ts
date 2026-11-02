import { preferences } from "../lib/preferences";

type MembershipItem = {
  track: string;
  segment: string;
  trackName?: string;
  segmentName?: string;
  stage?: string;
  fullSegmentName?: string;
};

type SourceDetail = {
  title: string;
  url: string;
  date: string;
};

type EventDetail = {
  date: string;
  kind: string;
  title: string;
  status: string;
  sourceUrl: string;
  sourceTitle: string;
};

type RelationDetail = {
  type: string;
  otherId: string;
  otherName: string;
  title: string;
  date: string;
  sourceUrl: string;
  sourceTitle: string;
};

type DexRoleDetail = {
  stageName: string;
  role: string;
  product: string;
  evidenceUrl: string;
  evidenceTitle: string;
};

type DexProductDetail = {
  product: string;
  form: string;
  dof: string;
  weight: string;
  actuation: string;
};

type CompanyRow = {
  id: string;
  name: string;
  en: string;
  region: string;
  country: string;
  founded?: number | null;
  founders?: string[];
  intro: string;
  website: string;
  valuation?: {
    text: string;
    asof: string;
    status: string;
  } | null;
  memberships: MembershipItem[];
  tags: string[];
  aliases: string[];
  sources: string[];
  sourceDetails?: SourceDetail[];
  verifiedAt: string;
  searchTerms: string[];
  eventsCount?: number;
  latestEvents?: EventDetail[];
  relations?: RelationDetail[];
  newsCount?: number;
  dexRoles?: DexRoleDetail[];
  dexProducts?: DexProductDetail[];
};

const root = document.querySelector("[data-mapping]");
if (root) {
  const data: CompanyRow[] = JSON.parse(
    document.getElementById("map-data")?.textContent || "[]",
  );
  const byId = new Map(data.map((c) => [c.id, c]));
  const form = document.getElementById("map-filters") as HTMLFormElement;
  const query = document.getElementById("map-query") as HTMLInputElement;
  const region = document.getElementById("map-region") as HTMLSelectElement;
  const segment = document.getElementById("map-segment") as HTMLSelectElement;
  const crossBtn = document.getElementById(
    "map-cross-only",
  ) as HTMLButtonElement | null;
  const activePills = document.getElementById("map-active-pills");
  const regionBtns = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-region-btn]"),
  ];
  const trackLinks = [
    ...document.querySelectorAll<HTMLAnchorElement>("[data-track-link]"),
  ];
  const trackNames = new Map(
    trackLinks
      .filter((a) => a.dataset.trackLink)
      .map((a) => [
        a.dataset.trackLink!,
        a.querySelector(".map-nav-name")?.textContent?.trim() ||
          a.dataset.trackLink!,
      ]),
  );

  let track = "";
  let view = "chain";
  let tag = "";
  let crossOnly = false;
  let filtered = data;

  function saveReturnState() {
    try {
      sessionStorage.setItem(
        "finmap-return-url",
        location.pathname + location.search,
      );
    } catch {
      // ignore storage errors
    }
  }

  function restore() {
    const p = new URLSearchParams(location.search);
    track = p.get("track") || "";
    tag = p.get("tag") || "";
    query.value = p.get("q") || tag;
    region.value = p.get("region") || "";
    segment.value = p.get("seg") || "";
    crossOnly = p.get("cross") === "1";
    view = p.get("view") === "table" ? "table" : "chain";
    if (segment.value && !track) track = segment.value.split("/")[0];
    if (!trackLinks.some((a) => a.dataset.trackLink === track)) track = "";
  }

  const haystacks = new Map(
    data.map((c) => [
      c.id,
      [
        c.name,
        c.en,
        c.intro,
        c.country,
        ...c.aliases,
        ...c.tags,
        ...(c.searchTerms || []),
      ]
        .join(" ")
        .normalize("NFKC")
        .toLowerCase(),
    ]),
  );

  function makePill(label: string, onRemove: () => void): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "map-active-pill";
    btn.innerHTML = `<span></span><i aria-hidden="true">×</i>`;
    btn.querySelector("span")!.textContent = label;
    btn.title = `移除筛选：${label}`;
    btn.addEventListener("click", onRemove);
    return btn;
  }

  function renderActivePills() {
    if (!activePills) return;
    activePills.replaceChildren();
    if (track) {
      activePills.append(
        makePill(`赛道: ${trackNames.get(track) || track}`, () => {
          track = "";
          segment.value = "";
          render();
        }),
      );
    }
    if (segment.value) {
      const opt = segment.querySelector<HTMLOptionElement>(
        `option[value="${CSS.escape(segment.value)}"]`,
      );
      activePills.append(
        makePill(`环节: ${opt?.textContent || segment.value}`, () => {
          segment.value = "";
          render();
        }),
      );
    }
    if (region.value) {
      activePills.append(
        makePill(`地区: ${region.value === "cn" ? "国内" : "海外"}`, () => {
          region.value = "";
          render();
        }),
      );
    }
    if (crossOnly) {
      activePills.append(
        makePill("仅跨环节公司", () => {
          crossOnly = false;
          render();
        }),
      );
    }
    if (query.value.trim()) {
      activePills.append(
        makePill(`关键词: ${query.value.trim()}`, () => {
          query.value = "";
          tag = "";
          render();
        }),
      );
    }
  }

  function render(updateUrl = true) {
    const text = query.value.trim().normalize("NFKC").toLowerCase();

    // Calculate base match (without track filter) to update sidebar counts dynamically
    const baseFiltered = data.filter(
      (c) =>
        (!region.value || c.region === region.value) &&
        (!crossOnly || c.memberships.length > 1) &&
        (!text ||
          text.split(/\s+/).every((w) => haystacks.get(c.id)?.includes(w))),
    );

    const totalEl = document.querySelector("[data-sidebar-total]");
    if (totalEl) totalEl.textContent = String(baseFiltered.length);
    document
      .querySelectorAll<HTMLElement>("[data-sidebar-count]")
      .forEach((b) => {
        const tid = b.dataset.sidebarCount!;
        const n = baseFiltered.filter((c) =>
          c.memberships.some((m) => m.track === tid),
        ).length;
        b.textContent = String(n);
      });

    filtered = baseFiltered.filter(
      (c) =>
        (!track || c.memberships.some((m) => m.track === track)) &&
        (!segment.value ||
          c.memberships.some(
            (m) => `${m.track}/${m.segment}` === segment.value,
          )),
    );

    const ids = new Set(filtered.map((c) => c.id));
    document
      .querySelectorAll<HTMLElement>("[data-company-id]")
      .forEach((el) => (el.hidden = !ids.has(el.dataset.companyId!)));
    document
      .querySelectorAll<HTMLElement>("[data-company-row]")
      .forEach((el) => (el.hidden = !ids.has(el.dataset.companyRow!)));

    document
      .querySelectorAll<HTMLElement>("[data-track-section]")
      .forEach((section) => {
        const id = section.dataset.trackSection!;
        const count = filtered.filter((c) =>
          c.memberships.some((m) => m.track === id),
        ).length;
        section.hidden =
          (!!track && track !== id) ||
          ((!!text || !!region.value || !!segment.value || crossOnly) &&
            count === 0);
        const label = section.querySelector("[data-track-count]");
        if (label) label.textContent = `${count} 家`;
      });

    document
      .querySelectorAll<HTMLElement>("[data-segment-cell]")
      .forEach((cell) => {
        const key = cell.dataset.segmentCell!;
        cell.hidden = !!segment.value && key !== segment.value;
        cell.classList.toggle(
          "is-single-seg",
          !!segment.value && key === segment.value,
        );
        const count = cell.querySelectorAll(
          "[data-company-id]:not([hidden])",
        ).length;
        const label = cell.querySelector("[data-cell-count]");
        if (label) label.textContent = String(count);
        cell.classList.toggle(
          "is-filtered-empty",
          count === 0 && (!!text || !!region.value || crossOnly),
        );
      });

    document
      .querySelectorAll<HTMLOptGroupElement>("#map-segment optgroup")
      .forEach((g) => {
        g.hidden = !!track && g.dataset.track !== track;
        g.disabled = g.hidden;
      });

    trackLinks.forEach((a) => {
      const on = (a.dataset.trackLink || "") === track;
      a.classList.toggle("is-on", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });

    regionBtns.forEach((btn) => {
      const on = (btn.dataset.regionBtn || "") === region.value;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });

    if (crossBtn) {
      crossBtn.setAttribute("aria-pressed", String(crossOnly));
      crossBtn.classList.toggle("is-on", crossOnly);
      crossBtn.classList.toggle("is-active", crossOnly);
    }

    document
      .querySelectorAll<HTMLElement>("[data-view]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.view === view)),
      );

    document.getElementById("map-chain")!.hidden =
      view !== "chain" || filtered.length === 0;
    document.getElementById("map-table")!.hidden =
      view !== "table" || filtered.length === 0;
    document.getElementById("map-empty")!.hidden = filtered.length !== 0;
    document.getElementById("map-results")!.textContent =
      `${filtered.length} 家公司 / 共 ${data.length} 家`;

    renderActivePills();

    if (updateUrl) {
      const p = new URLSearchParams();
      if (track) p.set("track", track);
      if (query.value.trim()) p.set("q", query.value.trim());
      if (region.value) p.set("region", region.value);
      if (segment.value) p.set("seg", segment.value);
      if (crossOnly) p.set("cross", "1");
      if (view === "table") p.set("view", view);
      history.replaceState(
        null,
        "",
        `${location.pathname}${p.size ? "?" + p : ""}`,
      );
    }
    saveReturnState();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    render();
  });
  query.addEventListener("input", () => render());
  region.addEventListener("change", () => render());
  regionBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      region.value = btn.dataset.regionBtn || "";
      render();
    });
  });
  segment.addEventListener("change", () => {
    if (segment.value) track = segment.value.split("/")[0];
    render();
  });
  crossBtn?.addEventListener("click", () => {
    crossOnly = !crossOnly;
    render();
  });

  function resetAll() {
    query.value = "";
    region.value = "";
    segment.value = "";
    track = "";
    tag = "";
    crossOnly = false;
    render();
  }

  form.addEventListener("reset", (e) => {
    e.preventDefault();
    resetAll();
  });
  document
    .getElementById("map-empty-reset")
    ?.addEventListener("click", resetAll);

  trackLinks.forEach((a) =>
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      track = a.dataset.trackLink || "";
      segment.value = "";
      render();
    }),
  );

  document.querySelectorAll<HTMLElement>("[data-filter-seg]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (
        e instanceof MouseEvent &&
        (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      )
        return;
      e.preventDefault();
      const segVal = el.dataset.filterSeg || "";
      if (segment.value === segVal) {
        segment.value = "";
      } else {
        segment.value = segVal;
        if (segVal) track = segVal.split("/")[0];
      }
      render();
    });
  });

  document.querySelectorAll<HTMLElement>("[data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      view = b.dataset.view!;
      render();
    }),
  );

  // Save current filter URL when navigating to any company profile
  document
    .querySelectorAll<HTMLAnchorElement>("[data-company-link]")
    .forEach((a) => {
      a.addEventListener("click", () => {
        saveReturnState();
      });
    });

  // Cross-segment hover highlight across all matrix cells
  document
    .querySelectorAll<HTMLElement>(".map-node[data-company-id]")
    .forEach((node) => {
      const cid = node.dataset.companyId!;
      node.addEventListener("mouseenter", () => {
        document
          .querySelectorAll<HTMLElement>(
            `.map-node[data-company-id="${CSS.escape(cid)}"]`,
          )
          .forEach((peer) => peer.classList.add("is-linked-hover"));
      });
      node.addEventListener("mouseleave", () => {
        document
          .querySelectorAll<HTMLElement>(".map-node.is-linked-hover")
          .forEach((peer) => peer.classList.remove("is-linked-hover"));
      });
    });

  // Quick Preview Inspector Drawer
  const drawer = document.querySelector<HTMLDialogElement>("#map-drawer");
  const closeBtn = document.getElementById("map-drawer-close");
  const drawerName = document.getElementById("drawer-name");
  const drawerSub = document.getElementById("drawer-sub");
  const drawerBody = document.getElementById("map-drawer-body");
  const drawerFullLink = document.getElementById(
    "drawer-full-link",
  ) as HTMLAnchorElement | null;
  const drawerSiteLink = document.getElementById(
    "drawer-site-link",
  ) as HTMLAnchorElement | null;

  function closeDrawer() {
    if (!drawer) return;
    drawer.close();
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("has-map-drawer");
  }

  function escHtml(s: string): string {
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function openDrawer(companyId: string) {
    const c = byId.get(companyId);
    if (!c || !drawer || !drawerBody) return;
    saveReturnState();
    if (drawerName) drawerName.textContent = c.name;
    if (drawerSub) {
      drawerSub.textContent = [
        c.en,
        c.country || (c.region === "cn" ? "国内" : "海外"),
        c.founded ? `${c.founded} 年成立` : "",
        c.verifiedAt ? `公开资料核验 ${c.verifiedAt}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (drawerFullLink) {
      drawerFullLink.href = `/venture/${c.id}/`;
      drawerFullLink.onclick = () => saveReturnState();
    }
    const follow = document.getElementById("drawer-follow");
    if (follow) {
      const watched = preferences().watching.includes(c.id);
      follow.dataset.companyFollow = c.id;
      follow.setAttribute("aria-pressed", String(watched));
      follow.textContent = watched ? "✓ 已关注公司" : "＋ 关注公司";
    }
    const updates = document.querySelector<HTMLAnchorElement>(
      "#drawer-updates-link",
    );
    if (updates) updates.href = `/?company=${encodeURIComponent(c.id)}&days=0`;
    if (drawerSiteLink) {
      if (c.website) {
        drawerSiteLink.href = c.website;
        drawerSiteLink.hidden = false;
      } else {
        drawerSiteLink.hidden = true;
      }
    }

    const posHtml = c.memberships
      .map(
        (m) => `
        <div class="drawer-pos-item">
          <div>
            <small>${escHtml(m.trackName || m.track)}</small>
            <strong>${escHtml(m.fullSegmentName || m.segmentName || m.segment)}</strong>
          </div>
          <div class="drawer-pos-actions">
            <button type="button" class="btn btn-sm" data-drawer-seg="${escHtml(m.track)}/${escHtml(m.segment)}">筛选本环节</button>
            <a class="link" href="/ventures/${escHtml(m.track)}/">赛道页 →</a>
          </div>
        </div>`,
      )
      .join("");

    const dexHtml =
      c.dexProducts?.length || c.dexRoles?.length
        ? `<section class="drawer-sec">
            <div class="drawer-sec-head">
              <h3>灵巧操作专题收录</h3>
              <a class="link" href="/ventures/dexterity/">查看专题对比 →</a>
            </div>
            ${
              c.dexProducts?.length
                ? c.dexProducts
                    .map(
                      (p) => `
                  <div class="drawer-dex-box">
                    <strong>${escHtml(p.product)} <span class="badge badge-plain">${escHtml(p.form)}</span></strong>
                    <dl class="drawer-dex-kv">
                      <div><dt>自由度</dt><dd>${escHtml(p.dof)}</dd></div>
                      <div><dt>重量范围</dt><dd>${escHtml(p.weight)}</dd></div>
                      <div><dt>驱动传动</dt><dd>${escHtml(p.actuation)}</dd></div>
                    </dl>
                  </div>`,
                    )
                    .join("")
                : ""
            }
            ${
              c.dexRoles?.length
                ? `<ul class="drawer-list">${c.dexRoles
                    .map(
                      (r) =>
                        `<li><strong>${escHtml(r.stageName)}</strong>：${escHtml(r.product)}（${escHtml(r.role)}） <a href="${escHtml(r.evidenceUrl)}" target="_blank" rel="noopener noreferrer">证据 ↗</a></li>`,
                    )
                    .join("")}</ul>`
                : ""
            }
          </section>`
        : "";

    const relHtml = c.relations?.length
      ? `<section class="drawer-sec">
          <div class="drawer-sec-head"><h3>已披露公司关系（${c.relations.length}）</h3></div>
          <ul class="drawer-list">
            ${c.relations
              .map(
                (r) =>
                  `<li><strong>${escHtml(r.type)} <a class="link" href="/venture/${escHtml(r.otherId)}/">${escHtml(r.otherName)}</a></strong>（${escHtml(r.date)}）：${escHtml(r.title)} <a href="${escHtml(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(r.sourceTitle)} ↗</a></li>`,
              )
              .join("")}
          </ul>
        </section>`
      : "";

    const evHtml = c.latestEvents?.length
      ? `<section class="drawer-sec">
          <div class="drawer-sec-head"><h3>近期已整理事件（共 ${c.eventsCount || c.latestEvents.length} 条）</h3></div>
          <ul class="drawer-list">
            ${c.latestEvents
              .map(
                (e) =>
                  `<li><span class="mono">${escHtml(e.date)}</span> · <strong>[${escHtml(e.kind)}]</strong> ${escHtml(e.title)} ${e.status === "reported" ? '<span class="v-rumor">报道</span>' : ""}</li>`,
              )
              .join("")}
          </ul>
        </section>`
      : "";

    const srcHtml = c.sourceDetails?.length
      ? `<section class="drawer-sec">
          <div class="drawer-sec-head"><h3>可回查公开来源（${c.sources.length} 条）</h3></div>
          <ul class="drawer-list">
            ${c.sourceDetails
              .map(
                (s) =>
                  `<li><a class="link" href="${escHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escHtml(s.title)} ↗</a> ${s.date ? `<small class="mono">(${escHtml(s.date)})</small>` : ""}</li>`,
              )
              .join("")}
          </ul>
        </section>`
      : "";

    drawerBody.innerHTML = `
      <section class="drawer-sec">
        <p class="drawer-intro">${escHtml(c.intro)}</p>
        <div class="drawer-kpis">
          <div><small>产业位置</small><b>${c.memberships.length} 个环节</b></div>
          <div><small>估值记录</small><b>${c.valuation ? escHtml(c.valuation.text) : "未披露"}</b></div>
          <div><small>资料核验日</small><b>${escHtml(c.verifiedAt || "未记录")}</b></div>
          <div><small>核验来源</small><b>${c.sources.length} 条出处</b></div>
        </div>
        ${
          c.tags.length
            ? `<div class="drawer-tags">${c.tags.map((t) => `<span class="map-tag-chip">${escHtml(t)}</span>`).join("")}</div>`
            : ""
        }
      </section>
      <section class="drawer-sec">
        <div class="drawer-sec-head">
          <h3>所属产业链位置（${c.memberships.length}）</h3>
        </div>
        <div class="drawer-pos-list">${posHtml}</div>
      </section>
      ${dexHtml}
      ${relHtml}
      ${evHtml}
      ${srcHtml}
    `;

    drawerBody
      .querySelectorAll<HTMLButtonElement>("[data-drawer-seg]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const segVal = btn.dataset.drawerSeg || "";
          segment.value = segVal;
          track = segVal.split("/")[0] || "";
          closeDrawer();
          render();
        });
      });

    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("has-map-drawer");
    if (!drawer.open) drawer.showModal();
    closeBtn?.focus();
  }

  document
    .querySelectorAll<HTMLElement>("[data-peek-company]")
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDrawer(btn.dataset.peekCompany!);
      });
    });

  closeBtn?.addEventListener("click", closeDrawer);
  drawer?.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDrawer();
  });
  drawer?.addEventListener("click", (e) => {
    if (
      e.target === drawer &&
      (e.clientX < drawer.getBoundingClientRect().left ||
        e.clientX > drawer.getBoundingClientRect().right)
    )
      closeDrawer();
  });

  window.addEventListener("popstate", () => {
    restore();
    render(false);
  });

  document.getElementById("map-export")?.addEventListener("click", () => {
    const csvCell = (value: string) =>
      '"' + value.replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"', '""') + '"';
    const rows = [
      [
        "公司",
        "英文名",
        "地区",
        "业务定位",
        "赛道/环节",
        "官网",
        "资料核验日",
        "来源",
      ],
      ...filtered.map((c) => [
        c.name,
        c.en,
        c.country || c.region,
        c.intro,
        c.memberships.map((m) => `${m.track}/${m.segment}`).join("; "),
        c.website,
        c.verifiedAt,
        [...new Set(c.sources)].join("; "),
      ]),
    ];
    const blob = new Blob(
      ["\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "finmap-companies.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  restore();
  render(false);
}
