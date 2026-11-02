/** A company directory needs one dated company action per company, not the full archive. */
export function directorySnapshot(snapshot) {
  const latest = new Map();
  for (const event of snapshot.events) {
    if (
      !["subject", "investor", "partner"].includes(event.role) ||
      !event.publishedAt
    )
      continue;
    const old = latest.get(event.companyId);
    if (!old || event.publishedAt > old.publishedAt)
      latest.set(event.companyId, event);
  }
  return { ...snapshot, projection: "directory", events: [...latest.values()] };
}
