import type { MonitorEvent } from "./monitor-types";

/** Undated records never become today's news just because the index was rebuilt. */
export function publicationTime(event: MonitorEvent): number {
  return event.publishedAt ? Date.parse(event.publishedAt) || 0 : 0;
}
export function sortEvents(
  events: MonitorEvent[],
  order = "published",
): MonitorEvent[] {
  return [...events].sort((a, b) => {
    const time = (e: MonitorEvent) =>
      order === "discovered"
        ? e.baseline
          ? 0
          : Date.parse(e.discoveredAt) || 0
        : publicationTime(e);
    return (
      time(b) - time(a) ||
      publicationTime(b) - publicationTime(a) ||
      a.id.localeCompare(b.id)
    );
  });
}
export function reconcileFilters<T extends { track: string; segment: string }>(
  state: T,
  changed = "",
): T {
  if (
    changed === "track" &&
    state.segment &&
    !state.segment.startsWith(state.track + "/")
  )
    state.segment = "";
  if (state.segment) state.track = state.segment.split("/")[0];
  return state;
}
export function eventDateLabel(event: MonitorEvent): string {
  if (event.publishedAt)
    return new Date(event.publishedAt).toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      ...(/T00:00:00(?:\.000)?Z$/.test(event.publishedAt)
        ? { timeZone: "UTC" }
        : {}),
    });
  return event.dateLabel ? event.dateLabel + " · 历史记录" : "发布时间未披露";
}
export function eventTimestamp(event: MonitorEvent): string {
  if (!event.publishedAt)
    return event.dateLabel
      ? event.dateLabel + "（仅有历史时间范围）"
      : "未披露";
  return /T00:00:00(?:\.000)?Z$/.test(event.publishedAt)
    ? event.publishedAt.slice(0, 10) + "（按日显示）"
    : new Date(event.publishedAt).toLocaleString("zh-CN");
}
