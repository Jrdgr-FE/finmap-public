import type { MonitorEvent } from "./monitor-types";
export interface Preferences {
  read: Record<string, number>;
  saved: string[];
  watching: string[];
  firstVisit: string;
  savedEvents?: Record<string, MonitorEvent>;
  dismissed?: string[];
  lastVisit?: string;
}
const key = "finmap-monitor-preferences-v1";
let memory: Preferences | undefined;
let sessionOnly = false;
export function preferences(): Preferences {
  if (sessionOnly && memory) return memory;
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      s &&
      s.read &&
      typeof s.read === "object" &&
      Array.isArray(s.saved) &&
      Array.isArray(s.watching)
    )
      return s;
  } catch {}
  return (
    memory ?? {
      read: {},
      saved: [],
      watching: [],
      firstVisit: new Date().toISOString(),
    }
  );
}
export function savePreferences(p: Preferences) {
  memory = p;
  let persisted = true;
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    persisted = false;
  }
  sessionOnly = !persisted;
  window.dispatchEvent(
    new CustomEvent("finmap:preferences", { detail: { persisted } }),
  );
  return persisted;
}
export function toggleWatch(id: string) {
  const p = preferences();
  p.watching = p.watching.includes(id)
    ? p.watching.filter((v) => v !== id)
    : [...p.watching, id];
  savePreferences(p);
}

export function toggleSaved(event: MonitorEvent) {
  const p = preferences();
  p.savedEvents ??= {};
  if (p.saved.includes(event.id)) {
    p.saved = p.saved.filter((id) => id !== event.id);
    delete p.savedEvents[event.id];
  } else {
    p.saved.push(event.id);
    p.savedEvents[event.id] = structuredClone(event);
  }
  return savePreferences(p);
}

export function cacheSavedEvents(events: MonitorEvent[]) {
  const p = preferences();
  let changed = false;
  for (const e of events)
    if (
      p.saved.includes(e.id) &&
      (!p.savedEvents?.[e.id] || p.savedEvents[e.id].revision < e.revision)
    ) {
      p.savedEvents ??= {};
      p.savedEvents[e.id] = structuredClone(e);
      changed = true;
    }
  if (changed) savePreferences(p);
}

/** Retain saved public metadata locally even after the bounded public feed rotates. */
export function withSavedEvents(events: MonitorEvent[], p = preferences()) {
  const all = new Map(events.map((e) => [e.id, e]));
  for (const id of p.saved) {
    const cached = p.savedEvents?.[id];
    if (cached && !all.has(id)) all.set(id, cached);
  }
  return [...all.values()];
}

export function toggleDismissed(id: string) {
  const p = preferences();
  p.dismissed = p.dismissed?.includes(id)
    ? p.dismissed.filter((v) => v !== id)
    : [...(p.dismissed ?? []), id];
  savePreferences(p);
}
