# Store Screenshot Extraction

Mobile Ad Agent must source app screenshots from real store/user assets only. It should
never invent screenshots, use icons as screenshots, or let a text note unlock a
source-backed creative route.

## Local Prototype

The local prototype uses `POST /api/extractions/from-url` and returns an
`AppExtraction` object for review.

App Store adapter:

- Parse the app id and country from the URL.
- Read app metadata through Apple lookup.
- Use lookup `screenshotUrls` / `ipadScreenshotUrls` when present.
- If lookup omits screenshots, fetch the public App Store page and extract real
  `mzstatic` `PurpleSource` screenshot artwork URLs.
- Dedupe image variants by source artwork and keep the largest store screenshot
  variant.
- Exclude AppIcon, Placeholder, small feature icons, and non-screenshot artwork.

Google Play adapter:

- Fetch the public Play listing page.
- Extract `play-lh.googleusercontent.com` image candidates.
- Keep only large screenshot-shaped images with URL dimensions.
- Dedupe variants by base image and prefer large portrait screenshots while still
  allowing landscape screenshots.
- Exclude tiny icons, badges, avatars, and rating artwork by area/aspect filters.

Website adapter:

- Extract metadata and OG image for context only.
- Website images do not count as app screenshots unless the user later uploads or
  selects real app screenshots/recordings for the agent to consider.

## Production Architecture

Production should move screenshot ingestion out of the web request and into a durable
worker pipeline:

```text
Dashboard/API/MCP URL intake
  -> Firestore appIntakes/{intakeId}
  -> Cloud Tasks enqueue extract_store_assets
  -> Cloud Run StoreExtractionWorker
  -> R2 raw asset objects
  -> Firestore assets + rawification candidates + claimCandidates + holds
  -> optional rawify_store_art worker for eligible listing art
  -> UI extraction worker over rawified/uploaded/captured screenshots
  -> Firestore uiObjects + proof candidates
  -> Review App Info checkpoint
```

Worker stages:

- Normalize store URL, platform, country, language, and app id/package id.
- Run platform source adapters in order.
- Fetch image bytes for candidates with bounded concurrency.
- Validate content type, file size, dimensions, aspect ratio, and perceptual duplicates.
- Reject icons, banners, placeholders, review avatars, ratings badges, and generic OG
  images as screenshot proof.
- Store accepted source images in R2 under content-hash/object-version keys.
- Store Firestore metadata only: object key, original URL, source adapter, dimensions,
  hash, trust level, and review status.
- Classify each store screenshot as raw-enough, rawifiable, marketing collage/mockup, or
  unusable. Listing art that needs rawification must go through rawification before UI
  extraction.
- Run OCR/vision UI extraction only on rawified candidates, user-uploaded raw screenshots,
  captured app screenshots, or screen recordings. UI extraction then produces UI object
  type, readable text, crop bounds, trust level, and claim alignment.
- Emit hard holds when no real screenshots are found.

Trust levels:

- `store_art`: real App Store / Play Store screenshot from the public listing. Useful
  for review and rawification candidates, but not UI-extracted proof unless it is raw
  enough or has first passed rawification.
- `rawified_store_art`: generated/rawified candidate derived from listing art, with
  provenance to the source asset and preservation QA status.
- `raw_app_proof`: user-uploaded or captured app screenshot/recording. Strongest proof.
- `website_context`: marketing/site image. Context only; cannot unlock proof-led ads.

Hard rules:

- No fake fallback assets.
- No icon-as-screenshot fallback.
- No text-note-as-screen fallback.
- No generated/rawified asset becomes source proof until preservation QA and review pass.
- If adapters find nothing, keep the app at `needs_screens` and ask for a real upload.
