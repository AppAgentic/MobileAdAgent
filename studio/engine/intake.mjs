// Stage 1 — App Intake.
// Normalize raw human/agent input into a canonical AppProfile + pack request.
// Deterministic, no network. Mirrors the architecture's `apps/{appId}` shape.
import { stableId, toLines, clamp } from './util.mjs';

const ALLOWED_FORMATS = ['ugc_video', 'image_ad', 'thumbnail'];
const ALLOWED_RATIOS = ['9:16', '4:5', '1:1', '16:9'];
const ALLOWED_CHANNELS = ['tiktok', 'meta_reels', 'instagram_reels', 'youtube_shorts'];

function normalizePlatforms(platforms) {
  const allowed = ['ios', 'android', 'web'];
  const list = (Array.isArray(platforms) ? platforms : toLines(platforms))
    .map((p) => String(p).toLowerCase().trim())
    .filter((p) => allowed.includes(p));
  return list.length ? Array.from(new Set(list)) : ['ios'];
}

export function runIntake(input = {}) {
  const app = input.app || {};
  const pack = input.pack || {};
  const notes = [];

  const name = String(app.name || 'Untitled App').trim();
  const appId = stableId('app', `${name}|${app.storeUrl || ''}`);

  const productFacts = toLines(app.productFacts);
  const avoidClaims = toLines(app.avoidClaims);

  if (productFacts.length === 0) {
    notes.push('No product facts supplied — script claims will be limited to none and QA will hold any claim.');
  }
  if (!app.storeUrl) {
    notes.push('No store URL — store-screenshot bootstrap unavailable; relying on uploaded proof only.');
  }

  const formats = (Array.isArray(pack.formats) ? pack.formats : toLines(pack.formats))
    .filter((f) => ALLOWED_FORMATS.includes(f));
  const aspectRatio = ALLOWED_RATIOS.includes(pack.aspectRatio) ? pack.aspectRatio : '9:16';
  const channels = (Array.isArray(pack.channels) ? pack.channels : toLines(pack.channels))
    .filter((c) => ALLOWED_CHANNELS.includes(c));

  const profile = {
    appId,
    name,
    storeUrl: app.storeUrl || null,
    platforms: normalizePlatforms(app.platforms),
    audience: String(app.audience || '').trim() || 'General mobile audience.',
    tone: String(app.tone || '').trim() || 'Authentic, direct, creator-style.',
    productFacts,
    avoidClaims,
    complianceNotes: toLines(app.complianceNotes),
  };

  const packRequest = {
    formats: formats.length ? Array.from(new Set(formats)) : ['ugc_video'],
    count: clamp(Number(pack.count) || 1, 1, 5),
    durationSeconds: clamp(Number(pack.durationSeconds) || 15, 6, 60),
    aspectRatio,
    channels: channels.length ? Array.from(new Set(channels)) : ['tiktok'],
    costCeilingUsd: clamp(Number(pack.costCeilingUsd) || 15, 1, 200),
  };

  return {
    stage: 'intake',
    profile,
    packRequest,
    notes,
  };
}
