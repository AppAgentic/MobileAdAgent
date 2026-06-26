# Mobile Ad Agent Dramatic Redesign Concepts

Generated: 2026-06-26

Model: `gpt-image-2`

## Outputs

- `mobile-ad-agent-dramatic-redesign-contact-sheet.png`
- `01-concierge-launchpad.png`
- `02-proof-ledger-workspace.png`
- `03-pack-builder-studio.png`
- `04-draft-review-gallery.png`
- `05-qa-export-room.png`

Prompt files are saved next to each PNG for reproducibility.

## My Read

The strongest product direction is the combination of:

1. `01-concierge-launchpad.png` for the first-run Launchpad structure.
2. `02-proof-ledger-workspace.png` for proof-backed claim review.
3. `04-draft-review-gallery.png` for the generated creative review surface.
4. `05-qa-export-room.png` for the final safety/export endpoint.

`03-pack-builder-studio.png` has useful progressive disclosure and credit-spend framing, but it leans a little too generic/purple and should be treated as structure only.

## Borrow

- A top command/navigation bar that makes the five-step flow visible without a heavy left sidebar on the Launchpad.
- A right-side "next steps" inspector that explains the sequence without adding extra sections.
- Proof source tray + claim ledger + proof inspector as the main Proof Review pattern.
- Review Drafts as a working approval room: output tabs, proof badges, selected preview, QA warnings, approve/request/regenerate actions.
- QA & Export as a calm manifest and checklist, with explicit download/share/ad-inbox handoff.

## Do Not Copy Blindly

- Generated app names, fake game creative, numbers, and exact UI copy.
- Extra nav items such as Analytics unless they become real product scope.
- Purple-heavy button styling from the generated screens.
- Any "start launch workflow" action unless it is clearly separated from export and approval-gated.

## Product Constraints To Preserve

- Flow remains Launchpad -> Proof Review -> Draft Pack Setup -> Review Drafts -> QA & Export.
- Top-level outputs remain only Image Ads and UGC Videos.
- No sample pack preview before proof and output setup approval.
- Credits are not spent until Generate drafts.
- Export is download/share/ad-inbox handoff only.
- Provider mutations must remain `0` unless a separate live launch path is explicitly approved.

## Implementation (2026-06-26, local-app)

Applied a "Command Deck" theme to `local-app/styles.css` as a final cascade
layer (token remap + surface overrides) and a small additive change to
`local-app/app.js`. The five-step flow, output set, proof gating, credit
gating, export-only handoff, and `provider mutations: 0` are all preserved.

- **Palette** — deep navy rail/top surfaces, crisp white workspace cards,
  blue→violet primary action (`#4a6cff`→`#4836d8`), green = approved/pass,
  amber = UGC/warnings, precise `rgba(15,23,41,.08)` hairlines.
- **Launchpad (01)** — kept the launch console (selected app summary, proof
  meter, lit sequence, Review-proof CTA), blue/amber output tiles, and added a
  numbered **"Your next steps"** rail to the inspector.
- **Proof Review (02)** — proof tray + claim ledger + inspector; segmented
  claim control now reads as a neutral track with a green "approve" state.
- **Review Drafts (04)** — recolored draft grid + recommended/approved
  outlines; the selected-creative preview is now a white approval card.
- **QA & Export (05)** — white export packet card, green pass checks, amber
  warnings, blue/violet export CTAs; provider-mutations/paid-network
  separation copy untouched.
- Headline scale dropped from 54px → 32px for cleaner hierarchy.

Validation note: `node`/`pnpm`/`agent-browser` are blocked by this
environment's permission policy, so `node --check`, `pnpm run smoke:local-app`,
and live screenshots could not be run here. `app.js` was unchanged structurally
(additive template markup only) and `styles.css` braces balance (625/625).
Re-run `node --check local-app/app.js` and `pnpm run smoke:local-app` in a
normal shell to confirm.
