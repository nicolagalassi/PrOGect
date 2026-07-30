# Design

## Theme

Dark graphite, cool (hue 210). Native to OGame's night-sky UI. Violet accent for action/selection/state only. Restrained register.

## Color (existing tokens, keep)

Ramp (surfaces): `--p1 hsl(210 32% 6%)` bg · `--p2 9%` surface · `--p3 12%` raised · `--p4 16%` border · `--p5 20%` · `--p6 30%`.
Roles: `--syl-bg` p1 · `--syl-surface` p2 · `--syl-raised` p3 · `--syl-border` p4.
Ink: `--syl-ink #dfe7ee` (body) · `--syl-muted #8494a3` (labels/secondary).
Accent: `--syl-accent #7c5cff` · `--syl-accent-weak hsl(255 90% 68% / .16)`.
Contrast: ink on p1/p2/p3 all clear ≥4.5:1. Labels must stay on the ink side, not muted-gray for prose.

## Typography

One family: `--syl-font 'Segoe UI', system-ui, …`. No display font. Fixed px/rem scale, tight ratio (~1.15). Section title 13px 700 uppercase; row label 13px; value/input 13px. No all-caps beyond short section titles.

## Radius / spacing

`--syl-radius 4px` (controls), 6–8px (cards/sections). Row rhythm: consistent min-height ~30px, vertical padding 6–7px, subtle 1px row divider inside sections for scannability.

## Components (one vocabulary)

- Toggle: 38×20 track, grey off → violet on, white knob. States: default/hover/focus/checked/disabled.
- Text/number input: `--syl-surface` bg, 1px `--syl-border`, right-aligned numbers, violet focus ring.
- Select: same box as input.
- "Open sub-panel" action (limiter/keyboard/ships/data/profiles): a consistent compact **icon button chip** on the right (bordered, hover-lit), never bare floating text/icon.
- Section: `--syl-surface`/`raised` block, rounded 8px, titled header with colored section icon.

## Motion

150–200ms ease-out on hover/focus/toggle only. No page-load choreography. `prefers-reduced-motion` → instant.

## Layout

Big settings = one scrollable page, sections in a 2-column multicol (`break-inside:avoid`), each section fully expanded (no accordion). Internal panels (limiter/keyboard/ships) take over the popup with a Back button.
