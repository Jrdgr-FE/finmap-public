import { preferences, toggleWatch } from "../lib/preferences";
function update() {
  const prefs = preferences();
  document.querySelectorAll<HTMLElement>("[data-pref-count]").forEach((el) => {
    el.textContent = String(
      el.dataset.prefCount === "watching"
        ? prefs.watching.length
        : prefs.saved.length,
    );
    el.hidden = el.textContent === "0";
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-company-follow]")
    .forEach((el) => {
      const on = prefs.watching.includes(el.dataset.companyFollow!);
      el.setAttribute("aria-pressed", String(on));
      el.innerHTML = on ? "✓ 已关注公司" : "+ 关注公司";
    });
  if (document.body.dataset.section === "updates") {
    const scope = new URLSearchParams(location.search).get("scope");
    document.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
      if (["updates", "watching", "saved"].includes(el.dataset.nav!)) {
        if (
          el.dataset.nav ===
          (scope === "watching" || scope === "saved" ? scope : "updates")
        )
          el.setAttribute("aria-current", "page");
        else el.removeAttribute("aria-current");
      }
    });
  }
}
update();
window.addEventListener("finmap:preferences", update);
window.addEventListener("finmap:scope", update);
window.addEventListener("storage", update);
document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(
    "[data-company-follow]",
  );
  if (b) toggleWatch(b.dataset.companyFollow!);
});
const menu = document.getElementById("menu-open"),
  sidebar = document.getElementById("workspace-sidebar")!,
  main = document.querySelector<HTMLElement>(".workspace-main")!,
  scrim = document.querySelector<HTMLElement>(".workspace-scrim")!;
const setMenu = (open: boolean) => {
  document.body.classList.toggle("menu-is-open", open);
  menu?.setAttribute("aria-expanded", String(open));
  scrim.hidden = !open;
  main.inert = open;
  if (open)
    requestAnimationFrame(() => {
      if (document.body.classList.contains("menu-is-open"))
        sidebar.querySelector<HTMLButtonElement>("[data-menu-close]")?.focus();
    });
  else menu?.focus();
};
sidebar.addEventListener("transitionend", (event) => {
  if (
    event.target === sidebar &&
    document.body.classList.contains("menu-is-open") &&
    !sidebar.contains(document.activeElement)
  )
    sidebar.querySelector<HTMLButtonElement>("[data-menu-close]")?.focus();
});
menu?.addEventListener("click", () => setMenu(true));
document
  .querySelectorAll("[data-menu-close]")
  .forEach((el) => el.addEventListener("click", () => setMenu(false)));
matchMedia("(min-width: 1001px)").addEventListener("change", (e) => {
  if (e.matches && document.body.classList.contains("menu-is-open"))
    setMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("menu-is-open"))
    setMenu(false);
  if (e.key === "Tab" && document.body.classList.contains("menu-is-open")) {
    const els = [
      ...sidebar.querySelectorAll<HTMLElement>("a,button,summary"),
    ].filter((el) => el.getClientRects().length);
    const first = els[0],
      last = els.at(-1);
    if (!sidebar.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
document.getElementById("search-open")?.addEventListener("click", () => {
  document.querySelector(".workspace-topbar")?.classList.toggle("is-searching");
  document.querySelector<HTMLInputElement>(".site-search input")?.focus();
});

const sectionLinks = [
  ...document.querySelectorAll<HTMLAnchorElement>(".company-section-nav a"),
];
const selectCompanySection = () => {
  const current = location.hash || "#company-updates";
  for (const a of sectionLinks)
    if (a.hash === current) a.setAttribute("aria-current", "location");
    else a.removeAttribute("aria-current");
};
selectCompanySection();
window.addEventListener("hashchange", selectCompanySection);
