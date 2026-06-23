# HyperFrames, Remotion, And Cloud Render Research

## HyperFrames

HyperFrames by HeyGen is an Apache 2.0 HTML/CSS/JS-to-video framework built for AI coding agents. It is relevant because mobile ad compositions can be expressed as normal web layouts with proof screenshots, proof crops, captions, CTA screens, thumbnails, and app icons.

Important findings:

- Hosted HyperFrames Cloud supports project uploads and async render jobs.
- Pay-as-you-go published concurrency is `10` concurrent video jobs.
- 1080p/30fps pricing is `0.1 credits` per output minute; dollar cost depends on the
  active HeyGen account plan / credit price.
- HyperFrames has self-host paths for AWS Lambda and GCP Cloud Run + Workflows.
- HyperFrames should be a first-class render backend candidate for Mobile Ad Agent.

## Remotion

Remotion remains a mature deterministic video renderer.

Important findings:

- Remotion Lambda is the strongest official scalable path.
- Vercel Sandbox is an easier newer option but should be benchmarked.
- Remotion Cloud Run package is alpha and not actively developed.
- Custom Docker render workers remain possible on Cloud Run.

## Cloudflare

Cloudflare is strong around:

- Agents/Durable Objects for agent sessions
- MCP endpoint hosting
- R2 asset storage
- Workflows/Queues for orchestration
- AI Gateway for model routing and observability

Cloudflare Containers should be treated as a prototype render path until production reliability is proven.

## Cost Notes

HeyGen hosted HyperFrames:

- 15s 1080p/30fps ad: `0.025 credits`
- 30s 1080p/30fps ad: `0.05 credits`
- 60s 1080p/30fps ad: `0.1 credits`

Cloud Run self-host:

- Expected to be cheaper at volume if renders are efficient.
- Cost depends on wall-clock render time, vCPU, memory, cold starts, and chunking.
- Approximate 30s examples:
  - `4 vCPU / 8 GiB` for `90s`: about `$0.010`
  - `4 vCPU / 8 GiB` for `3min`: about `$0.021`
  - `8 vCPU / 16 GiB` for `3min`: about `$0.042`
  - `8 vCPU / 16 GiB` for `4min`: about `$0.056`

## Recommendation

Use hosted HyperFrames Cloud first for prototype and early v1, while storing all composition source, assets, manifests, and outputs in our own portable artifact system. Benchmark self-hosted HyperFrames on GCP before moving high-volume rendering.
