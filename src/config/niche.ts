// Single source of truth for niche extraction from goal text.
// Used by orchestrator (planning + execution) and company profile first-goal suggestions.

export function nicheFor(goalText: string): string {
  // "for X" and "selling X" both name the niche; stop at a dash or comma so
  // "for trending sneakers, 3 products" extracts just the niche.
  const forMatch = goalText.match(/\b(?:for|selling)\b\s+(.+?)(?:\s*—|,|$)/i)?.[1];
  const dashPart = goalText.split("—").length > 1
    ? goalText.split("—").pop()!.split(",")[0]
    : undefined;
  return (forMatch ?? dashPart ?? "the target market").trim();
}
