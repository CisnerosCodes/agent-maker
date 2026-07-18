# Loom Recording Plan — Agent-Maker Demo

Goal: one clean 3:30 take recorded natively in Loom tonight. Budget 60–90
minutes total: 20 min staging, 10 min dry run, then takes. Expect to keep
take 2 or 3 — nobody keeps take 1.

## 1. Stage the machine (do once, ~20 min)

1. `npm run dev` in the repo root; confirm http://localhost:4000 loads and
   the org chart renders. Leave this terminal running and MINIMIZED — it
   never appears on camera.
2. **Full dress rehearsal off camera first.** Run the entire demo path once:
   launch goal → answer the CEO → Approve & hire → wait for deliverable →
   inject poisoned doc → Deny → relaunch same goal for the memory beat. Time
   each phase with your phone. If any phase takes longer than the script's
   voiceover covers, note where you will vamp (see §4).
3. **Seed run memory, then reset correctly.** The Act 3 speedup needs a
   prior run in `data/runs.json`. Check whether `reset demo` clears runs.json:
   if it does, the on-camera Act 1 build IS run one and Act 3 is run two —
   which works, as long as you use the exact same niche answer both times
   (memory matches on niche key). Decide your niche answer now and never
   improvise it: `trending sneakers, 3 products`.
4. Browser prep (use a normal Chrome window, not incognito, so Loom's
   extension works if you use it):
   - Exactly three tabs, in order: intro card, localhost:4000, outro card.
   - Hide the bookmarks bar (Ctrl+Shift+B). Close every other window.
   - Zoom the dashboard so text is legible at 1080p — Ctrl+Plus to ~110–125%,
     check that the goal input, org chart, and channel are all visible.
   - F11 fullscreen is optional; if you use it, practice the tab switches
     (Ctrl+Tab still works, or exit fullscreen at the card switches).
5. OS prep: Do Not Disturb ON (Win+N → focus), Discord/Slack/Steam closed,
   no low-battery risk (plug in), dark wallpaper in case the desktop flashes.
6. Autonomy dial: set the mode (assisted / supervised / autonomous) BEFORE
   recording and leave it. Supervised is the right one — the script sells
   supervision.

## 2. Loom settings (~5 min)

- loom.com or the desktop app → New recording → **Screen only** (no camera
  bubble — it covers the dashboard; judges want the product) OR camera bubble
  small in the bottom-right if the hackathon prefers faces. Decide once.
- Record the **entire screen**, not the tab — you switch tabs during the take.
- Microphone: pick your best mic, then record 10 seconds, play it back, and
  listen. Room echo and keyboard clatter are the two killers; lower the
  keyboard volume beat by typing gently during the goal input.
- Loom free tier caps at 5 minutes — this is fine (script is 3:30) but it
  means you cannot ramble. If you have Loom Business through the hackathon,
  still treat 5:00 as the wall.
- Turn OFF Loom's countdown-clicks sound if it bleeds into the mic.

## 3. The take

- Print the script or put it on a phone/second monitor — never on the
  recording screen.
- Speak 10% slower than feels natural. Smile on the cold open line; it is
  audible.
- Follow the script's bold cues exactly. The mouse is a pointer for the
  viewer: move it deliberately to the thing you are talking about, and park
  it when you are not.
- Type the goal live (typing reads as real; pasting reads as canned).
- Loom lets you pause (Alt+Shift+P on desktop app) — legal to use while
  waiting on a slow phase, but a visible dashboard doing work is BETTER than
  a cut. Prefer vamping (§4) over pausing.

## 4. Vamp lines (memorize two)

If the demo is slower than the script, fill with these instead of silence:

- "Every one of these messages is going onto one persisted bus — that is the
  audit trail a security review actually asks for."
- "Notice nothing on this screen needs an API key — the whole spine runs
  offline, and each layer flips to its real integration with one env var."

## 5. After the take (~10 min)

- Watch it back ONCE at 1x. Kill it only for: audio problems, an error on
  screen you did not recover from, or running past 5:00. Do not kill it for
  a single stumble — one human stumble reads as live and real.
- Trim dead air at the start and end in Loom's editor. Do not over-edit; the
  5-minute wall is the only hard constraint.
- Title it: "Agent-Maker — AI employees you can trust and audit | AITX x
  NVIDIA Claw Hackathon". Set link permissions to "Anyone with the link" and
  test the link in an incognito window before submitting.
- Add the video description: the one-liner + repo link + team names.

## 6. Failure recovery cheatsheet

| Symptom | Move |
|---|---|
| CEO question never appears | `reset demo`, restart take — do not debug on camera |
| Deliverable phase drags past your vamp lines | Narrate the event log entries, then Loom-pause as a last resort |
| Poisoned doc banner slow to appear | Keep talking the two-payload explanation — it buys ~15s naturally |
| Run 2 shows no speedup | Cut Act 3 entirely; close from the attack — script still lands at ~3:00 |
| Take is 5:10 | Trim the cold open card hold + outro hold in Loom's editor first; they are pure padding |

## 7. Division of labor tonight

- Whoever has the calmest recorded voice reads. The other person sits
  off-camera with the script, timing phases and hand-signaling "stretch" /
  "move on".
- Alex owns the submission checklist (link permissions, description, form).
