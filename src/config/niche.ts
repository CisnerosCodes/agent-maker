export function nicheFor(goalText: string): string {
  const forMatch = goalText.match(/\bfor\b\s+(.+?)(?:\s*—|$)/i)?.[1];
  const dashPart = goalText.split("—").length > 1
    ? goalText.split("—").pop()!.split(",")[0]
    : undefined;
  return (forMatch ?? dashPart ?? "the target market").trim();
}
