# Mobile Ad Agent Auth And Tenant Infrastructure Plan

Date: 2026-07-07

## Why This Is Next

The local prototype now proves the paid Launch Pack flow can run end to end, but it is still session-local. The next production step is auth plus tenant-owned state so we can test real user journeys and verify that app profiles, screenshots, packs, credits, review decisions, exports, and learning events land in the right customer boundary.

## Product Principle

Use one tenant model that works for solo users, small teams, and larger companies from the start:

`User -> Org -> Workspace -> Apps -> Packs`

- Solo customer: one user, one auto-created org, one default workspace.
- Team customer: one org, shared default workspace, multiple members and roles.
- Larger company or agency: one org, multiple workspaces for brands, apps, clients, or business units.

Billing and credit ownership live at the org level. App data and creative work live in workspaces. This keeps the first implementation simple while avoiding a migration when teams and larger companies arrive.

Important implementation note from Fable review: build the IDs from day one, not the UI. The first shipped version can auto-create one default workspace per org and hide workspace switching, while still storing `workspaceId` everywhere so teams and larger companies do not require a future data migration.

## Customer Types

### Solo Founder / Growth Lead

- One user signs up after checkout or before paid generation.
- System auto-creates org and default workspace.
- User is `owner`.
- Launch Pack entitlement or monthly credits attach to the org.
- All imported apps, packs, and exports are owned by the default workspace.

### Small Team

- One org, one or more workspaces.
- Roles:
  - `owner`: all access, billing, team management.
  - `admin`: apps, packs, exports, members except billing ownership.
  - `creator`: import apps, generate packs, review drafts.
  - `reviewer`: comment/approve/reject, no generation or billing.
  - `billing`: billing, invoices, credits, no creative admin required.
- Invite links create pending memberships with role and workspace scope.
- Review links can be external and limited to a pack.

### Larger Company / Agency

- One org with multiple workspaces.
- Workspaces can represent brands, apps, client accounts, markets, or teams.
- Org-level billing and credit pool, with optional workspace spend caps.
- Workspace roles and audit logs become important.
- Later additions: SSO/SAML, SCIM, domain capture, custom data retention, API service accounts, approval policies, client-facing review portals.

## Core Firebase Shape

Preferred Firestore hierarchy:

```text
users/{uid}
orgs/{orgId}
orgs/{orgId}/members/{uid}
orgs/{orgId}/invites/{inviteId}
orgs/{orgId}/workspaces/{workspaceId}
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}/appProfiles/{profileId}
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}/sourceAssets/{assetId}
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}/creativePacks/{packId}
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}/creativePacks/{packId}/generatedCreatives/{creativeId}
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}/creativePacks/{packId}/reviewDecisions/{decisionId}
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}/learningEvents/{eventId}
orgs/{orgId}/creditLedger/{txnId}
orgs/{orgId}/entitlements/{entitlementId}
orgs/{orgId}/apiKeys/{apiKeyId}
orgs/{orgId}/auditEvents/{eventId}
renderTasks/{taskId}
previewCache/{canonicalAppId}
previewSessions/{sessionId}
```

Use org/workspace nesting for user-owned product data because Firestore rules become easier to reason about. Use top-level `renderTasks` only for worker queues that need cross-org processing, with org/workspace/app/pack IDs copied onto every task and validated server-side.

Denormalize `orgId`, `workspaceId`, and `appId` onto every leaf document that may be queried outside its direct parent path. This matters for collection group queries and security rules because rules cannot cheaply walk arbitrary ancestors.

`previewCache` and `previewSessions` are server-only pre-auth collections. Clients never read or write them directly. `previewCache/{canonicalAppId}` stores cheap public store extraction results with a short TTL so repeated previews of the same app do not re-spend extraction cost. `previewSessions/{sessionId}` stores an httpOnly/signed-session pointer to the cached app preview, lightweight UI selections, and expiry only. Anonymous preview data never lives in the tenant tree until an authenticated claim copies it into an org/workspace.

## Auth And Access

- Firebase Auth for sign-in.
- Start with email link or email/password plus Google sign-in.
- On first sign-in, create `users/{uid}`, then create or join an org through a server-controlled bootstrap endpoint.
- Store membership in `orgs/{orgId}/members/{uid}`.
- Use custom claims only for coarse flags if needed, not as the source of truth for every org role.
- Firestore rules require authenticated user plus org membership.
- All credit mutations, generation starts, entitlement grants, API keys, and provider/render calls must go through server/Admin SDK paths, never direct client writes.

## Billing And Credits

- Org owns plan, subscription status, credit balance, and Launch Pack entitlements.
- Monthly plan credits and top-up credits are separate ledger categories.
- Launch Pack is a one-time entitlement:
  - Grant enough credits for `24 image ads + 4 UGC ads`.
  - Mark entitlement as `launch_pack`.
  - First Launch Pack generation consumes those credits exactly.
- Ongoing plans:
  - Launch: $99/month, 600 credits.
  - Scale: $249/month, 2,000 credits.
  - Studio: $599/month, 6,000 credits.
- Top-ups require active subscription unless explicitly sold by sales.
- Payment webhook is the only source of truth for paid entitlement grants in production.

## Asset And Render Ownership

Every generated or uploaded asset should have:

- `orgId`
- `workspaceId`
- `appId`
- `packId` when relevant
- `sourceType`
- `storageKey`
- `createdBy`
- `createdAt`
- `qaStatus`

R2/GCS object keys should mirror the tenant boundary:

```text
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}/source/{assetId}
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}/packs/{packId}/creatives/{creativeId}
orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}/packs/{packId}/exports/{exportId}
```

No public signed URL should be stored as durable source of truth. Store object keys and generate short-lived access URLs server-side when needed.

For imported store screenshots, copy usable screenshots into owned storage under tenant-scoped keys during the import-persistence phase. Persisting Apple/Google CDN URLs as durable source of truth is acceptable only as a written temporary shortcut; production should own the assets.

## First Production Flow

### Same-Day Launch Pack

1. Landing page CTA.
2. User pastes app URL.
3. Server returns an anonymous ephemeral preview: icon, summary, key features, screenshot grid, readiness gaps, and no generated ads.
4. User checks that the app was found correctly.
5. Checkout for $249 Launch Pack; checkout email doubles as account creation or sign-in.
6. Payment webhook grants the Launch Pack entitlement once.
7. Server idempotently creates org/default workspace and claims the preview into that workspace.
8. Server creates app profile and source assets under the workspace, copying usable screenshots into owned tenant-scoped storage.
9. User reviews app summary, key features, and screenshots.
10. User presses Next.
11. Server preauthorizes credits and creates creative pack.
12. Render/generation tasks write outputs and QA reports under the pack.
13. User approves/rejects/tweaks drafts.
14. Export packages only approved assets.
15. Post-pack upsell to Launch/Scale/Studio continuity.

### Ephemeral Preview And Claim

URL entry is the first visible action for human acquisition flows: organic landing, paid Launch Pack landing, and pricing/subscription pages. The returning dashboard shows existing apps first, with `Add app by URL` as the primary add action. Agent/API flows are different: the agent or API client must authenticate first, then pass a URL as the first import parameter.

Allowed before auth:

- Store URL parsing for App Store and Google Play links.
- Cheap extraction of public store metadata: icon, name, summary, key-feature candidates, claim candidates, screenshot list, screenshot readiness, and gaps.
- Screenshots displayed from store CDN URLs only.
- A short-lived preview session token so the same visitor can return to the preview.

Not allowed before auth:

- Image ad or UGC ad generation, including sample ads.
- Persistent profile edits, learning events, exports, uploads, credits, entitlements, or ledger writes.
- Arbitrary website extraction.
- Deep or expensive extraction passes.

Claim mechanics:

- `previewCache/{canonicalAppId}` stores server-owned public extraction results shared across visitors for roughly 7 days.
- `previewSessions/{sessionId}` stores a signed/httpOnly session pointer to `canonicalAppId`, lightweight selections, and a 24-48 hour expiry; no PII.
- The bootstrap endpoint accepts an optional `previewSessionId`.
- Given an authenticated UID and valid session, the server copies cached extraction into `orgs/{orgId}/workspaces/{workspaceId}/apps/{appId}`, `appProfiles`, and `sourceAssets`.
- The server copies screenshots into tenant-scoped storage during claim, not during anonymous preview.
- The claim path is idempotent on user/session/canonical app ID.
- Preview responses and claimed records pass the provider-name leak guard.

## Security Rules Direction

- Users can read their own `users/{uid}`.
- Org members can read org metadata and workspace data according to role.
- Reviewers can read assigned packs and write review decisions only.
- Creators/admins can create app profiles and creative packs.
- Billing users can read billing/ledger state but cannot directly mutate credits.
- Client cannot write `creditLedger`, `entitlements`, `renderTasks`, `generatedCreatives`, `apiKeys.secretHash`, or `auditEvents`.
- Client cannot read or write `previewCache` or `previewSessions`; all preview access goes through server endpoints.
- Server endpoints validate:
  - authenticated UID
  - org membership
  - workspace permission
  - entitlement/credit availability
  - idempotency key
  - provider mutations remain zero unless explicitly approved.

Pre-auth preview endpoints must also validate:

- Store-domain allowlist for anonymous preview: App Store and Google Play only.
- Canonical app ID cache key.
- Per-IP/session rate limits, with bot challenge after repeated previews.
- Daily anonymous-preview cost ceiling and kill switch.
- No private-IP fetches, redirect abuse, arbitrary website crawling, uploads, or generation.

## Testing Plan

Use Firebase emulators before live Firebase data:

1. Seed users:
   - solo owner
   - team owner
   - team creator
   - team reviewer
   - billing-only user
   - second org outsider
2. Rules tests:
   - user cannot read another org
   - reviewer cannot start generation or see billing
   - creator cannot mutate credits
   - billing user cannot edit app profile
   - server/Admin path can write credit ledger and render tasks
   - client cannot read or write `previewCache` or `previewSessions`
3. Browser E2E:
   - Anonymous URL preview -> Launch Pack checkout mock -> sign-up -> org bootstrap + claim -> review app info -> generate -> approve -> export.
   - Anonymous URL preview -> sign-up -> claim -> app profile and screenshots persist under the correct org/workspace.
   - Team invite -> reviewer approves drafts but cannot generate.
   - Second org cannot open first org app, pack, or export URL.
4. Data readback:
   - App profile lands under correct org/workspace.
   - Source assets use correct org/workspace/app path.
   - Creative pack stores requested mix, credit estimate, status, and creator UID.
   - Credit ledger debits exact amount.
   - Review decisions create learning events under the same app.
   - Export manifest includes org/workspace/app/pack IDs but no backend provider secrets.
5. Provider-name leak guard:
   - Extend the local smoke guard so preview payloads, persisted Firestore payloads, and export manifests do not expose backend provider/model names in customer-visible records.
6. Abuse/COGS guard:
   - First import of a canonical app ID creates a preview cache entry.
   - Second import of the same app hits cache.
   - Rate limit or bot challenge fires after repeated anonymous previews.

## Build Sequence

### Phase 0: Lock Tenant And Server-Owned Schemas

- Finalize `User -> Org -> Workspace -> Apps -> Packs`.
- Design document schemas for apps, app profiles, source assets, creative packs, generated creatives, review decisions, learning events, exports, credit ledger, entitlements, render tasks, audit events, preview cache, and preview sessions.
- Lock the storage key scheme for source assets, generated media, QA artifacts, and exports.
- Draft the Firestore rules skeleton and required indexes.
- Decide trusted server shape for Admin SDK endpoints: preview import, bootstrap, preview claim, entitlement grant, credit debit, pack creation, and export manifest writes.

### Phase 1: Auth Shell And Tenant Bootstrap

- Add Firebase web config via environment.
- Add sign-in/sign-up UI.
- Add idempotent server endpoint for first-user org/workspace bootstrap with optional `previewSessionId` claim.
- Add one hidden/default workspace per org; no workspace switcher UI yet.
- Add emulator seeds and security rules test harness.
- Exit test: sign up, create org/default workspace, claim is idempotent when a preview session is provided, reload safely, and prove a second signed-in user cannot read the first org's workspace data.

### Phase 2a: Persist Import And App Profile

- Replace in-memory app list with Firestore-backed org/workspace/app documents.
- Build the extraction service as session-agnostic with two callers: anonymous preview and authenticated durable import/claim.
- Anonymous URL preview writes only server-owned preview cache/session records and returns app-info preview payloads.
- Authenticated URL import or claim writes app profile, claims/features, source screenshots, and holds to Firestore.
- Store or copy screenshots under tenant-scoped object keys, not as durable third-party CDN URLs.
- Review app info reads/writes Firestore.
- Exit test: anonymous URL preview, sign up, idempotent bootstrap + claim, app profile and screenshots persist across reload, and cross-tenant reads are denied by rules tests.

### Phase 2b: Persist Pack Lifecycle

- Keep generation mocked but write creative pack records to Firestore.
- Store mocked generated creatives as `generatedCreatives`.
- Store approve/reject/tweak decisions as `reviewDecisions`.
- Store learning events under the app.
- Store export manifests under the pack.
- Exit test: mocked pack saved, draft approved, learning event created, export manifest saved, provider/model names absent from customer-visible docs.

### Phase 3: Credits And Launch Pack Entitlement

- Add server-side credit ledger.
- Add Launch Pack entitlement state.
- Change `/preview?offer=launch-pack` local mode into server-owned entitlement state.
- Add mock checkout endpoint that calls the same entitlement-grant function the real webhook will use later.
- Use idempotency keys for grants and debits.
- Verify `24 image ads + 4 UGC ads` consumes exactly 336 credits and cannot be double-granted or double-debited by retry.

### Phase 4: Real Checkout And Webhook Grants

- Add real checkout in test mode.
- Verify webhook signatures.
- Webhook calls the existing entitlement-grant function and writes an append-only ledger event.
- Failed/canceled payments remove generation ability but preserve app/profile data.
- Exit test: payment webhook grants Launch Pack entitlement once, replay does not double-credit.

### Phase 5: Team Roles And Review Links

- Add invites.
- Add reviewer role and pack-specific review permissions.
- Add pack-specific review links.
- Add audit events for approvals, exports, credit spends, and role changes.

### Phase 6: Real Generation And Storage Workers

- Replace mocked generation with server-created render tasks.
- Persist outputs, QA reports, manifests, costs, and storage keys under the creative pack.
- Keep provider/model names internal.
- Keep provider mutations at zero unless a guarded export destination is explicitly approved.

### Phase 7: Larger Company Readiness

- Add multiple workspaces per org.
- Add workspace spend caps.
- Add API keys/service accounts scoped to org/workspace.
- Add SSO/SAML only when a real larger customer needs it.

## Immediate Recommendation

Build Phase 0, Phase 1, and Phase 2a next. Fable's updated recommendation is to keep the engineering milestone focused on durable tenant boundaries while making the visible human UX URL-first:

`anonymous URL preview -> sign up -> idempotent org/default workspace bootstrap + claim -> app profile + screenshots persist across reload -> second signed-in user is denied by rules tests`

That proves the riskiest parts first: URL-first acquisition, bootstrap idempotency, tenant boundaries, claim semantics, rules shape, and URL-import persistence. Then Phase 2b can persist the pack/review/export lifecycle. After that, add server-owned credits and Launch Pack entitlement, then real checkout. Anonymous preview guardrails such as cache hits, rate limits, bot challenge, TTL cleanup, and preview leak checks should be in place before real paid traffic. Team roles and larger-company controls should wait until the solo/paid Launch Pack path is durable.
