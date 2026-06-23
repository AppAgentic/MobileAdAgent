# Mobile Ad Agent

## Overview

Mobile Ad Agent is an AppAgentic product for generating mobile paid-ad creative from real app proof. It takes app screenshots, App Store metadata, app icons, target audience, creative guidance, and optional agent instructions, then produces paid-ad-ready UGC videos and image ads with auditable proof, QA, and downloadable/exportable source inventory.

The product is intended to be human-usable and agent-native. Claude Code, Codex, Cursor, and similar coding agents should be able to create workspaces, upload proof packs, request creative packs, inspect QA reports, iterate variants, and retrieve outputs through API/MCP.

## Product Boundaries

- Mobile Ad Agent is a creative factory, not an ad buying platform.
- Generated assets remain source inventory until QA and any required approval pass.
- The product may hand off approved assets to paid-ad inboxes or customer exports through explicit integration rails, but it must not mutate ad-network spend directly.
- Real app proof matters. Do not invent UI, fake values, unsupported claims, or fabricated app screens.

## Initial Stack Direction

- **Business**: AppAgentic
- **Control plane**: Next.js on Firebase App Hosting
- **Auth/state**: Firebase Auth + Firestore
- **Asset lake**: Cloudflare R2
- **Agent surface**: hosted API + remote MCP over Streamable HTTP
- **Render backend**: swappable render abstraction
  - V1 candidate: HeyGen HyperFrames Cloud
  - Portable self-host candidate: HyperFrames on GCP Cloud Run + Workflows
  - Benchmark/fallback: Remotion Lambda / custom Cloud Run render workers
- **Workers**: Cloud Run services/jobs or equivalent container workers for heavy generation, render, OCR, ffmpeg, and multimodal QA

## Core Workflow

1. App intake from screenshots, App Store URL, icon, product facts, audience, and creative guidance.
2. Proof ingestion and classification.
3. Proof object extraction from screenshots or recordings.
4. Creative planning for UGC video ads and image ads.
5. Script, caption, thumbnail, CTA, and image/layout generation.
6. Deterministic render using proof-backed assets.
7. OCR, visual, duration, codec, claim, and proof-fidelity QA.
8. Repair/iterate when QA holds.
9. Package outputs, manifests, and QA reports for download, MCP/API retrieval, or downstream paid-ad inbox handoff.

## Agent Stages

- Creative Director Agent
- Proof Agent
- Script Agent
- Render Planner
- Render Worker
- QA Agent
- Handoff Agent

Each stage should emit structured state and audit data. Intelligence is allowed to propose, repair, rank, and critique. Deterministic rails own storage, billing, proof existence, cost ceilings, render settings, artifact paths, approval gates, and provider handoffs.

## Commands

This repository starts as a project shell and planning spine. Add concrete commands when the app scaffold is created.

```bash
# Development
# To be added after scaffold selection

# Tests
# To be added after scaffold selection
```

## Environment Variables

Do not commit secrets, API keys, tokens, cookies, service-account JSON, or signed URLs. Store credentials in the appropriate AppAgentic vault/Secret Manager path and reference them through runtime configuration.

Expected future categories:

- Firebase public web config
- Firebase Admin runtime identity
- R2 bucket/account credentials
- HyperFrames/HeyGen API key
- Model provider keys
- Webhook signing secrets
- API/MCP auth secrets

## Research Notes

See `docs/plans/mobile-ad-agent-architecture.md` for the initial architecture decisions from the launch planning thread.
