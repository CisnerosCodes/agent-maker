# Generated media — Higgsfield shot list

> **Status (Jul 18):** the Higgsfield MCP connector is linked but the account's
> plan returns `only_website_usage_on_trial_is_available` (403) for API jobs —
> the unlimited Seedance/Nano-Banana day works **on higgsfield.com only**.
> Generate there with the prompts below and drop the files at the paths given;
> the pages pick them up automatically, no code changes.

The landing page has two drop-in media slots. Both are **optional**: pages detect
whether the file exists and hide the slot when it doesn't, so nothing breaks
without them. Drop files at the exact paths below and refresh — no code changes.

All files live in `dashboard/media/` (served at `/media/...`).

## Brand palette (paste into prompts)

- Violet `#8b5cf6` · deep violet `#6d28d9` · lavender `#c4b5fd`
- Fuchsia accent `#d946ef` · honey gold `#f5b83d`
- Background near-black purple `#0a0716`

## Shot 1 — Bee mascot hero (Nano Banana, image)

**File:** `dashboard/media/bee-hero.png` — transparent background PNG, ~1200×1200.
Shown floating on the right side of the landing hero.

> A low-poly geometric worker bee mascot, faceted origami style, made of sharp
> triangular polygons. Body bands alternate deep violet (#6d28d9) and honey gold
> (#f5b83d), translucent lavender crystal wings, glowing fuchsia rim light.
> Flying at a slight upward angle toward the viewer, dynamic and confident, not
> cute or cartoonish — premium tech-brand mascot. Dark transparent background,
> studio product lighting, subtle purple glow underneath. 3D render, octane
> style, high detail, no text.

Variants worth generating while it's unlimited: front-facing portrait (About /
social cards), a swarm of 5 bees around a glowing hexagon (OG image, 1200×630 —
save as `dashboard/media/og.png`).

## Shot 2 — 60-second demo film (Seedance 2.0, video)

**File:** `dashboard/media/demo.mp4` — 16:9, 1080p, H.264, keep under ~40 MB.
Appears as a video player in the "Recursive intelligence" section.

Best use: screen-record the real dashboard demo (goal → org spawns → poisoned
doc → deny → goal completes), then use Seedance for a 5–8s cinematic *intro
shot* to cut in front of it:

> Cinematic slow dolly through a dark purple void, a glowing geometric beehive
> core made of violet crystal facets pulses with golden light at the center,
> dozens of small low-poly bees made of purple and gold triangles orbit it
> leaving faint light trails, a vast honeycomb lattice grid floor glows beneath,
> volumetric purple fog, camera pushes toward the hive heart as it flares,
> color palette deep violet #6d28d9, fuchsia #d946ef, honey gold #f5b83d,
> premium tech launch film, 24fps, no text, no people.

## Optional — hero background loop (Seedance 2.0)

**File:** `dashboard/media/hero-loop.mp4` (not wired yet — the live Three.js
scene fills this role; ask if you want a video fallback wired instead).

## Checklist

- [ ] `bee-hero.png` generated + dropped in `dashboard/media/`
- [ ] `demo.mp4` (Seedance intro + screen recording cut) dropped in
- [ ] refresh landing page — both slots appear automatically
