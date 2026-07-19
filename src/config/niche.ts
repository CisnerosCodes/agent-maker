// Single source of truth for niche extraction from goal text.
// Used by orchestrator (planning + execution) and company profile first-goal suggestions.

export function nicheFor(goalText: string): string {
  const forMatch = goalText.match(/\bfor\b\s+(.+?)(?:\s*—|$)/i)?.[1];
  const dashPart = goalText.split("—").length > 1
    ? goalText.split("—").pop()!.split(",")[0]
    : undefined;
  return (forMatch ?? dashPart ?? "the target market").trim();
}