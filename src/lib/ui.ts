export const paths: Record<string, string> = {
  inbox: "M4 4h16v16H4z M4 13h5l2 3h2l2-3h5",
  grid: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  network: "M9 3h6v5H9z M3 16h6v5H3z M15 16h6v5h-6z M12 8v4 M6 16v-4h12v4",
  star: "m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9z",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  activity: "M3 12h4l3-7 4 14 3-7h4",
  book: "M4 3h12a3 3 0 0 1 3 3v15H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3 M3 17h16 M8 7h7 M8 11h5",
  building:
    "M5 21V3h14v18 M9 7h1 M14 7h1 M9 11h1 M14 11h1 M9 15h1 M14 15h1 M10 21v-3h4v3",
  search: "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  external: "M14 3h7v7 M21 3l-10 10 M10 5H4v15h15v-6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14 M5 12h14",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12 M6 18 18 6",
  refresh: "M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 14 6 M4 12a8 8 0 0 0 14 6",
  filter: "M4 6h16 M7 12h10 M10 18h4",
  clock: "M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  globe:
    "M3 12h18 M12 3c6 5 6 13 0 18-6-5-6-13 0-18 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  sun: "M12 3v1 M12 20v1 M3 12h1 M20 12h1 M5.6 5.6l.7.7 M17.7 17.7l.7.7 M18.4 5.6l-.7.7 M6.3 17.7l-.7.7 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  moon: "M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  bolt: "m13 2-9 12h7l-1 8 10-13h-7z",
  info: "M12 11v6 M12 7v.1 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
};
export const icon = (name: string) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
  (paths[name] ?? paths.grid) +
  '"/></svg>';
export const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function safeHref(s: string) {
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password
      ? u.href
      : "#";
  } catch {
    return "#";
  }
}
export const when = (s?: string | null) =>
  s && Number.isFinite(Date.parse(s))
    ? new Date(s).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "尚无记录";
export const initial = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, /^[A-Za-z]/.test(name) ? 2 : 1)
    .toUpperCase();
export const hue = (id: string) =>
  [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 5;
// Re-rendered actions retain keyboard focus, including inside the reader dialog.
export function captureActionFocus(root: HTMLElement) {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) return () => {};
  const scope = active.closest<HTMLDialogElement>("dialog[open]") ?? root;
  const attr = [
    "data-save",
    "data-watch",
    "data-read-event",
    "data-open-detail",
    "data-library-watch",
    "data-clear-filter",
  ].find((name) => active.hasAttribute(name));
  const value = attr ? active.getAttribute(attr)! : "";
  return () => {
    if (active.isConnected || !attr) return;
    scope
      .querySelector<HTMLElement>(`[${attr}="${CSS.escape(value)}"]`)
      ?.focus({ preventScroll: true });
  };
}
