# Mobile Ad Agent Firebase Readiness

Date: 2026-07-08

## What Changed

- Added a shared tenant model in `lib/tenant-model.mjs` so memory and Firestore adapters use the same document shapes.
- Kept the local memory adapter for prototype smoke tests, but made `MAA_TENANT_BACKEND=firestore` select the production-shaped Firestore adapter.
- Added lazy Firebase Admin initialization with application-default credentials or runtime env credentials. No secrets are committed.
- Added Firebase Auth bearer-token verification for Firestore mode. Tenant endpoints ignore client-supplied UIDs when a verified token is present.
- Added a Firestore adapter for idempotent bootstrap and preview claim:
  - `users/{uid}`
  - `orgs/{orgId}`
  - `orgs/{orgId}/members/{uid}`
  - `orgs/{orgId}/workspaces/{workspaceId}`
  - `orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}`
  - app profile and source asset subcollections
  - server-only claims, entitlements, credit ledger, and audit events
- Expanded Firestore rules with membership/role helpers, self-profile validation, server-written tenant state, billing-role reads for ledger/entitlements, and explicit denies for preview cache/sessions, render tasks, API keys, audit events, and claim idempotency docs.
- Added static and emulator rules test scripts.
- Added a read-only Firebase readiness checker that verifies project, service, Firestore, Auth, rules-release, App Hosting, storage, and runtime-secret presence without printing secret values.
- Added `.firebaserc` so Firebase CLI commands target `mobileadagent` explicitly.
- Added `apphosting.yaml` plus App Hosting build/start scripts for the Firebase App Hosting runtime.
- Initialized live Firebase Auth for `mobileadagent` and enabled email/password sign-in.
- Deployed the live Firestore rules release and five composite indexes from this repo.
- Enabled Firestore point-in-time recovery and database delete protection.
- Created the Firebase App Hosting backend `mobileadagent-web` in `us-central1`, attached it to the Mobile Ad Agent web app, and deployed the first successful rollout.
- Created the App Hosting source bucket `mobileadagent-apphosting-source-581210343786` and dedicated App Hosting runtime service account `firebase-app-hosting-compute@mobileadagent.iam.gserviceaccount.com`.

## Firebase App Hosting

Firebase App Hosting is the selected web runtime for Mobile Ad Agent.

- Backend: `projects/mobileadagent/locations/us-central1/backends/mobileadagent-web`
- URL: `https://mobileadagent-web--mobileadagent.us-central1.hosted.app`
- Current build: `build-0708-0845-routes`
- Current rollout: `rollout-0708-0845-routes`
- Rollout state: `SUCCEEDED`
- Runtime mode: `MAA_TENANT_BACKEND=firestore`, `MAA_AUTH_MODE=firebase`
- Health check: `GET /api/health`

Live route contract:

- `/`: public marketing homepage.
- `/pricing`: public pricing section.
- `/launch-pack`: public Same-Day Launch Pack offer.
- `/preview`: pre-auth app URL preview/import.
- `/app`: authenticated dashboard shell.
- `/app/apps/:appId`: app profile workspace shell.
- `/app/packs/:packId`: pack review/export shell.
- `/login`: sign-in entry.
- `/signup`: sign-up entry.
- Legacy prototype paths `/landing`, `/landing/`, `/dashboard`, `/?u=...`, and `/?pack=...` return 404.

## Runtime Modes

Local memory mode:

```bash
pnpm run local:app
```

Firestore mode:

```bash
MAA_TENANT_BACKEND=firestore MAA_AUTH_MODE=firebase pnpm run local:app
```

Firestore mode expects Firebase Admin credentials from the AppAgentic runtime identity, ADC, or runtime env. Do not write service-account JSON, private keys, API keys, or tokens into the repo.

## Validation Status

Passed:

```bash
node --check lib/firebase-admin.mjs
node --check lib/server-auth.mjs
node --check lib/firestore-tenant-store.mjs
node --check lib/tenant-store-factory.mjs
node --check scripts/firestore-rules-static-test.mjs
node --check scripts/firestore-rules-emulator-test.mjs
node --check scripts/run-firestore-rules-emulator-test.mjs
node --check scripts/firebase-readiness-check.mjs
pnpm run build:apphosting
pnpm run test:tenant
pnpm run test:firestore-rules
pnpm run test:firestore-rules:emulator
pnpm run smoke:local-app
curl -fsS https://mobileadagent-web--mobileadagent.us-central1.hosted.app/api/health
```

The machine's default Java is OpenJDK 17, but Homebrew JDK 21 is installed at `/opt/homebrew/opt/openjdk@21`. The emulator test runner selects that JDK automatically before starting Firebase Tools.

Live project audit:

```bash
pnpm run check:firebase-readiness
```

Latest result:

```text
pass=30 warn=0 fail=0
```

The live project currently has:

- Active Firebase project and web app.
- Required Firebase, App Hosting, Cloud Build, Artifact Registry, Cloud Run, Firestore, Firebaserules, Identity Toolkit, Secure Token, Secret Manager, and Storage APIs enabled.
- Firestore Native default database in `us-central1`.
- Firebase Auth initialized with email/password enabled, password required, duplicate emails disabled, and default authorized domains `mobileadagent.firebaseapp.com` / `mobileadagent.web.app`.
- Firestore point-in-time recovery and delete protection enabled.
- Firestore rules release `cloud.firestore` deployed from this repo.
- Composite indexes for apps, creative packs, learning events, credit ledger, and render tasks are `READY`.
- Firebase App Hosting backend `mobileadagent-web` with URI `mobileadagent-web--mobileadagent.us-central1.hosted.app`.
- Successful App Hosting rollout `rollout-0708-0845-routes` serving build `build-0708-0845-routes`.
- App Hosting source bucket `mobileadagent-apphosting-source-581210343786`.
- Runtime secret names for model extraction and R2 present in Secret Manager.

## Remaining Production Gaps

- Real hosted Firebase Auth UI/session plumbing is not built into the browser UI yet.
- Firestore mode has code-level wiring, emulator-verified rules, and live Firebase Auth/rules/index readiness.
- R2/GCS asset copying is still represented by tenant-scoped storage keys and source metadata; actual object copy/upload workers are next.
- Payment webhooks and real entitlement grants are still mocked/local. The Firestore adapter writes idempotent entitlement and credit ledger docs for the preview-claim shape, but checkout webhooks are not live.
