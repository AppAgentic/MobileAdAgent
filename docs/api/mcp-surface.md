# Initial API And MCP Surface

Mobile Ad Agent should expose the same core workflow to humans through the web UI and to agents through API/MCP.

## Tools

### `create_workspace`

Creates or returns a workspace for an organization.

### `create_app`

Creates an app profile with name, store URLs, platforms, brand guidance, and compliance notes.

### `bootstrap_app_from_store_url`

Fetches app metadata, icon, and screenshots from an App Store URL, then creates an intake record and proof-classification task.

### `upload_screenshot_pack`

Uploads raw screenshots, recordings, or app proof assets.

### `extract_proof_objects`

Runs proof object extraction against uploaded screenshots or recordings.

### `generate_creative_pack`

Creates a creative job for a requested mix of UGC videos and image ads.

### `get_job_status`

Returns current job, task, render, and QA state.

### `get_qa_report`

Returns structured QA verdicts, reasons, media previews, and repair suggestions.

### `iterate_creative`

Requests revisions against a creative pack or held creative.

### `download_creative_pack`

Returns signed short-lived download links for approved pack artifacts.

### `create_handoff`

Creates an explicit export or downstream handoff record. This is not an ad-network mutation.

## Safety

- Require API auth for every tool.
- Enforce workspace/app scopes.
- Enforce per-workspace rate limits and cost ceilings.
- Return signed URLs only when requested and never store them as canonical state.
- Keep all expensive operations async.
- Emit audit events for every state transition.
