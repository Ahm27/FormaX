export function toDisplayId(id: number | null | undefined, displayId?: number | null) {
  if (typeof displayId === "number" && Number.isFinite(displayId)) {
    return String(displayId);
  }

  if (typeof id !== "number" || !Number.isFinite(id)) {
    return "-";
  }

  return String(id);
}
