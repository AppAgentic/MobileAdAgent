/* Live source-generation adapters.

   Same contract as the local mocks in generation-adapters.mjs:
     imageAd.generateImageAd({ task, source })    -> { asset, costUnits, providerCalls }
     ugcFirstFrame.generateFirstFrame({ task, source }) -> { asset, costUnits, providerCalls }
     ugcSegment.generateSegment({ task, source, inputAssets }) -> { asset, costUnits, providerCalls }

   Providers create SOURCE LAYERS ONLY (image ad canvases, creator clips).
   They never render app UI, captions, CTAs, icons, or factual text — the
   finishing compositor owns those from real proof assets. Asset records and
   thrown task errors stay provider-neutral; precise provider diagnostics go
   to the injected ledger, which only operator-facing canary reports read. */

import { sha256 } from './asset-store.mjs';
import { createGeminiMediaClient } from './providers/gemini-media.mjs';
import { createPersistedHookAgentAdapter } from './hook-agent-adapter.mjs';
import { createPersistedScriptAgentAdapter } from './script-agent-adapter.mjs';
import { probeImage, probeMp4 } from './media-probe.mjs';

export function createGenerationLedger() {
  const calls = [];
  const blockers = [];
  return {
    calls,
    blockers,
    recordCall(entry) {
      calls.push({ ...entry, at: new Date().toISOString() });
    },
    recordBlocker(blocker) {
      blockers.push({ ...blocker, at: new Date().toISOString() });
    },
    generationProviderCalls() {
      return calls.filter((call) => call.kind === 'generation').length;
    },
    creativeIntelligenceCalls() {
      return calls.filter((call) => call.kind === 'intelligence').length;
    },
  };
}

export function createLiveGenerationAdapters({
  env = process.env,
  secretResolver,
  assetStore,
  ledger,
  mediaClientFactory = createGeminiMediaClient,
} = {}) {
  if (typeof secretResolver !== 'function') {
    throw new Error('Live generation adapters need a secretResolver({ purpose }) from the worker runtime.');
  }
  if (!assetStore) {
    throw new Error('Live generation adapters need an asset store.');
  }
  if (typeof assetStore.putObjectIfAbsent !== 'function') {
    throw new Error('Live generation adapters need conditional-create asset storage.');
  }
  const audit = ledger || createGenerationLedger();

  let clientPromise = null;
  function client() {
    if (!clientPromise) {
      clientPromise = Promise.resolve(secretResolver({ purpose: 'media_generation' })).then((apiKey) => {
        if (!apiKey) throw new Error('Media generation credentials are not configured for this worker.');
        return mediaClientFactory({
          apiKey,
          onCall: (entry) => audit.recordCall(entry),
          timeoutMs: Number(env.MAA_GENERATION_TIMEOUT_MS || 180_000),
        });
      });
    }
    return clientPromise;
  }

  const imageAd = {
    id: 'image-ad-live',
    capability: 'image_ad',
    live: true,
    ledger: audit,
    async generateImageAd({ task, source }) {
      return generateDurableMedia({
        task,
        source,
        assetStore,
        audit,
        capability: 'image_ad',
        kind: task.outputType,
        mediaType: 'image',
        maxProviderCallsPerAttempt: 6,
        generate: async () => (await client()).generateImage({
          prompt: imageSourcePrompt({ task, source }),
          aspectRatio: aspectRatioFor(task.spec.dimensions),
        }),
      });
    },
  };

  const hookAgent = createPersistedHookAgentAdapter({
    assetStore,
    live: true,
    id: 'hook-intelligence-live',
    recordBlocker: (blocker) => audit.recordBlocker(blocker),
    generateJson: async ({ stage, prompt, schema }) => (await client()).generateJson({
      prompt,
      schema,
      model: env.MAA_HOOK_TEXT_MODEL || 'gemini-3.5-flash',
      label: stage,
    }),
  });
  hookAgent.ledger = audit;

  const scriptAgent = createPersistedScriptAgentAdapter({
    assetStore,
    live: true,
    id: 'script-intelligence-live',
    recordBlocker: (blocker) => audit.recordBlocker(blocker),
    generateJson: async ({ stage, prompt, schema }) => (await client()).generateJson({
      prompt,
      schema,
      model: env.MAA_SCRIPT_TEXT_MODEL || env.MAA_HOOK_TEXT_MODEL || 'gemini-3.5-flash',
      label: stage,
    }),
  });
  scriptAgent.ledger = audit;

  const ugcFirstFrame = {
    id: 'ugc-creator-frame-live',
    capability: 'ugc_creator_frame',
    live: true,
    ledger: audit,
    async generateFirstFrame({ task, source }) {
      return generateDurableMedia({
        task,
        source,
        assetStore,
        audit,
        capability: 'ugc_creator_frame',
        kind: 'ugc_first_frame',
        mediaType: 'image',
        maxProviderCallsPerAttempt: 6,
        generate: async () => (await client()).generateImage({
          prompt: creatorFirstFramePrompt({ task, source }),
          aspectRatio: '9:16',
        }),
      });
    },
  };

  const ugcSegment = {
    id: 'ugc-creator-block-live',
    capability: 'ugc_creator_block',
    live: true,
    ledger: audit,
    async generateSegment({ task, source, inputAssets = [] }) {
      const requestedSeconds = chooseCreatorClipDurationSeconds({ task });
      const referenceAsset = inputAssets.find((asset) => asset.kind === 'ugc_first_frame') || null;
      let referenceImage = null;
      if (task.spec.sharedFirstFrameTaskId) {
        if (!referenceAsset?.storageKey) {
          audit.recordBlocker({
            taskId: task.taskId,
            capability: 'ugc_creator_block',
            stage: 'source_generation',
            detail: 'Missing shared first-frame asset before creator segment generation.',
            attempts: null,
          });
          throw neutralError('Creator source generation is missing its shared reference frame.', { providerCalls: 0 });
        }
        referenceImage = {
          bytes: await assetStore.getObject(referenceAsset.storageKey),
          mimeType: referenceAsset.contentType || 'image/png',
        };
      }
      return generateDurableMedia({
        task,
        source,
        assetStore,
        audit,
        capability: 'ugc_creator_block',
        kind: 'ugc_segment',
        mediaType: 'video',
        maxProviderCallsPerAttempt: 1,
        generate: async () => (await client()).generateVideo({
          prompt: creatorSegmentPrompt({ task, source, requestedDurationSeconds: requestedSeconds, hasReferenceImage: Boolean(referenceImage) }),
          aspectRatio: '9:16',
          durationSeconds: requestedSeconds,
          negativePrompt: task.spec.firstFrameNegativePrompt || 'phone screen content, app interface, on-screen text, captions, subtitles, logos, watermarks',
          referenceImage,
        }),
      });
    },
  };

  return { hookAgent, scriptAgent, imageAd, ugcFirstFrame, ugcSegment, ledger: audit };
}

export function chooseCreatorClipDurationSeconds({ task } = {}) {
  const plannedSeconds = Math.max(2, Number(task?.spec?.endSeconds) - Number(task?.spec?.startSeconds) || 0);
  const spokenWords = String(task?.spec?.spokenLine || '').trim().split(/\s+/).filter(Boolean).length;
  // Ordinary UGC delivery is slower than a readout. Reserve half a second
  // for natural onset/landing, then choose the smallest provider-supported
  // clip that covers both the planned window and the estimated speech.
  const estimatedSpeechSeconds = spokenWords ? (spokenWords / 2.6) + 0.5 : 0;
  const neededSeconds = Math.max(plannedSeconds, estimatedSpeechSeconds);
  return [4, 6, 8, 10].find((allowed) => allowed >= neededSeconds) || 10;
}

const MEDIA_RECEIPT_SCHEMA_VERSION = 'media-generation-receipt.v1';

/* Provider generation is not assumed to be idempotent. Each live task first
   writes an immutable call intent, then writes its source object with
   conditional-create semantics. A retry reuses a validated object. If a
   worker disappeared after the call started but before an object or a
   definitive failure was recorded, the task holds instead of spending on a
   duplicate call. */
async function generateDurableMedia({
  task,
  source,
  assetStore,
  audit,
  capability,
  kind,
  mediaType,
  maxProviderCallsPerAttempt,
  generate,
}) {
  const attempt = Math.max(1, Number(task?.attempts) || 1);
  const requestFingerprint = mediaRequestFingerprint({ task, source });
  let receipts = await readMediaReceipts({ assetStore, task, requestFingerprint, throughAttempt: attempt });
  let existing;
  try {
    existing = await readPersistedMedia({ assetStore, task, kind, mediaType, allowMissing: true });
  } catch (error) {
    audit.recordBlocker({ taskId: task.taskId, capability, stage: 'asset_readback', detail: error.message, attempts: null });
    throw mediaTaskError('A durable source object exists but failed media validation.', {
      nonRetryable: true,
      providerCalls: unaccountedProviderCalls(task, receipts),
    });
  }
  if (existing) {
    if (!receipts.some((entry) => entry.intent)) {
      throw mediaTaskError('An unverified source object already exists for this task.', {
        nonRetryable: true,
        providerCalls: 0,
      });
    }
    return mediaResult({
      task,
      asset: existing.asset,
      providerCalls: providerCallsRecordedByReceipts(receipts),
      reusedArtifact: true,
    });
  }

  const unresolved = receipts.find((entry) => entry.intent && (entry.success || !entry.failure || entry.failure.outcome === 'ambiguous'));
  if (unresolved) {
    audit.recordBlocker({
      taskId: task.taskId,
      capability,
      stage: 'ambiguous_provider_outcome',
      detail: `Attempt ${unresolved.attempt} has a durable call intent but no validated source object.`,
      attempts: null,
    });
    throw mediaTaskError('Source generation has an ambiguous prior outcome and will not be repeated automatically.', {
      nonRetryable: true,
      providerCalls: unaccountedProviderCalls(task, receipts),
    });
  }

  const current = receipts.find((entry) => entry.attempt === attempt);
  if (current?.failure?.outcome === 'definitive') {
    throw mediaTaskError('This source-generation attempt already recorded a definitive failure.', {
      nonRetryable: true,
      providerCalls: unaccountedProviderCalls(task, receipts),
    });
  }

  const intent = {
    schemaVersion: MEDIA_RECEIPT_SCHEMA_VERSION,
    receiptType: 'intent',
    taskId: task.taskId,
    idempotencyKey: task.idempotencyKey || task.taskId,
    requestFingerprint,
    outputStorageKey: task.output.storageKey,
    attempt,
    maxProviderCalls: Math.max(1, Number(maxProviderCallsPerAttempt) || 1),
    createdAt: new Date().toISOString(),
    providerMutations: 0,
  };
  const intentStored = await assetStore.putObjectIfAbsent({
    storageKey: mediaReceiptKey(task, attempt, 'intent'),
    bytes: Buffer.from(JSON.stringify(intent, null, 2)),
    contentType: 'application/json',
  });
  if (intentStored.created === false) {
    receipts = await readMediaReceipts({ assetStore, task, requestFingerprint, throughAttempt: attempt });
    const racedOutput = await readPersistedMedia({ assetStore, task, kind, mediaType, allowMissing: true });
    if (racedOutput) {
      return mediaResult({
        task,
        asset: racedOutput.asset,
        providerCalls: providerCallsRecordedByReceipts(receipts),
        reusedArtifact: true,
      });
    }
    throw mediaTaskError('Source generation already has an in-flight or ambiguous attempt.', {
      nonRetryable: true,
      providerCalls: unaccountedProviderCalls(task, receipts),
    });
  }

  const callsBefore = audit.generationProviderCalls();
  let generated;
  try {
    generated = await generate();
  } catch (error) {
    const actualCalls = Math.max(0, audit.generationProviderCalls() - callsBefore);
    const outcome = definitiveProviderFailure(error, actualCalls) ? 'definitive' : 'ambiguous';
    audit.recordBlocker({
      taskId: task.taskId,
      capability,
      stage: outcome === 'definitive' ? 'source_generation' : 'ambiguous_provider_outcome',
      detail: error.message,
      attempts: error.attempts || null,
    });
    try {
      await writeMediaOutcomeReceipt({
        assetStore,
        task,
        requestFingerprint,
        attempt,
        receiptType: 'failure',
        outcome,
        providerCalls: actualCalls,
        providerStatuses: providerStatuses(error),
      });
    } catch (receiptError) {
      audit.recordBlocker({
        taskId: task.taskId,
        capability,
        stage: 'receipt_persistence',
        detail: receiptError.message,
        attempts: null,
      });
      throw mediaTaskError('Source generation outcome could not be recorded safely.', {
        nonRetryable: true,
        providerCalls: actualCalls,
      });
    }
    receipts = await readMediaReceipts({ assetStore, task, requestFingerprint, throughAttempt: attempt });
    throw mediaTaskError(
      outcome === 'definitive'
        ? 'Source generation is unavailable right now.'
        : 'Source generation has an ambiguous outcome and will not be repeated automatically.',
      {
        nonRetryable: outcome === 'ambiguous',
        providerCalls: unaccountedProviderCalls(task, receipts),
      },
    );
  }

  // A successful provider result necessarily represents at least one live
  // generation request, even if a custom provider client failed to emit its
  // normal operator-ledger callback.
  const actualCalls = Math.max(1, audit.generationProviderCalls() - callsBefore);
  const bytes = Buffer.isBuffer(generated?.bytes) ? generated.bytes : Buffer.from(generated?.bytes || []);
  if (!bytes.byteLength) {
    await writeMediaOutcomeReceipt({
      assetStore,
      task,
      requestFingerprint,
      attempt,
      receiptType: 'failure',
      outcome: 'definitive',
      providerCalls: actualCalls,
      providerStatuses: [],
    });
    receipts = await readMediaReceipts({ assetStore, task, requestFingerprint, throughAttempt: attempt });
    throw mediaTaskError('Source generation returned no media bytes.', {
      providerCalls: unaccountedProviderCalls(task, receipts),
    });
  }

  try {
    await assetStore.putObjectIfAbsent({
      storageKey: task.output.storageKey,
      bytes,
      contentType: generated.mimeType || task.output.contentType,
    });
  } catch (error) {
    audit.recordBlocker({ taskId: task.taskId, capability, stage: 'asset_persistence', detail: error.message, attempts: null });
    try {
      await writeMediaOutcomeReceipt({
        assetStore,
        task,
        requestFingerprint,
        attempt,
        receiptType: 'failure',
        outcome: 'ambiguous',
        providerCalls: actualCalls,
        providerStatuses: [],
      });
    } catch {
      // The intent remains the durable fail-closed marker if even the outcome
      // receipt cannot be stored.
    }
    throw mediaTaskError('Generated source media could not be persisted safely.', {
      nonRetryable: true,
      providerCalls: actualCalls,
    });
  }

  let persisted;
  try {
    persisted = await readPersistedMedia({ assetStore, task, kind, mediaType, allowMissing: false });
  } catch (error) {
    audit.recordBlocker({ taskId: task.taskId, capability, stage: 'asset_readback', detail: error.message, attempts: null });
    await writeMediaOutcomeReceipt({
      assetStore,
      task,
      requestFingerprint,
      attempt,
      receiptType: 'failure',
      outcome: 'ambiguous',
      providerCalls: actualCalls,
      providerStatuses: [],
    }).catch(() => {});
    throw mediaTaskError('Generated source media failed immutable readback validation.', {
      nonRetryable: true,
      providerCalls: actualCalls,
    });
  }

  try {
    await writeMediaOutcomeReceipt({
      assetStore,
      task,
      requestFingerprint,
      attempt,
      receiptType: 'success',
      outcome: 'stored',
      providerCalls: actualCalls,
      providerStatuses: [],
      checksum: persisted.asset.checksum,
      bytes: persisted.asset.bytes,
    });
  } catch (error) {
    // The conditionally-created, probed output is itself a durable result.
    // A retry will recover it and conservatively account from the intent.
    audit.recordBlocker({ taskId: task.taskId, capability, stage: 'receipt_persistence', detail: error.message, attempts: null });
  }
  receipts = await readMediaReceipts({ assetStore, task, requestFingerprint, throughAttempt: attempt });
  return mediaResult({
    task,
    asset: persisted.asset,
    providerCalls: unaccountedProviderCalls(task, receipts),
    reusedArtifact: false,
  });
}

async function readPersistedMedia({ assetStore, task, kind, mediaType, allowMissing }) {
  if (!(await assetStore.exists(task.output.storageKey))) {
    if (allowMissing) return null;
    throw new Error('The conditionally-created source object is missing.');
  }
  const bytes = Buffer.from(await assetStore.getObject(task.output.storageKey));
  const probe = mediaType === 'video' ? probeMp4(bytes) : probeImage(bytes);
  if (!probe.ok) throw new Error(`The durable source object is not valid ${mediaType} media: ${probe.reason}`);
  const contentType = mediaType === 'video'
    ? 'video/mp4'
    : probe.container === 'jpeg' ? 'image/jpeg' : 'image/png';
  const stored = {
    storageKey: task.output.storageKey,
    contentType,
    bytes: bytes.byteLength,
    checksum: sha256(bytes),
  };
  return {
    bytes,
    probe,
    asset: liveAssetRecord({
      task,
      kind,
      stored,
      width: probe.width || task.spec?.dimensions?.width || null,
      height: probe.height || task.spec?.dimensions?.height || null,
      // Browser-frame compositors must sequence creator visuals by the video
      // track, not the often slightly longer AAC/container duration. Seeking
      // a video element into that audio-only tail produces a dark seam frame.
      durationSeconds: mediaType === 'video' ? round2(probe.videoDurationSeconds || probe.durationSeconds) : null,
      mediaValidation: 'parsed',
    }),
  };
}

async function readMediaReceipts({ assetStore, task, requestFingerprint, throughAttempt }) {
  const receipts = [];
  for (let attempt = 1; attempt <= throughAttempt; attempt += 1) {
    const entry = { attempt, intent: null, success: null, failure: null };
    for (const receiptType of ['intent', 'success', 'failure']) {
      const key = mediaReceiptKey(task, attempt, receiptType);
      if (!(await assetStore.exists(key))) continue;
      let receipt;
      try {
        receipt = JSON.parse(Buffer.from(await assetStore.getObject(key)).toString('utf8'));
      } catch (error) {
        throw mediaTaskError(`Durable media ${receiptType} receipt could not be read: ${error.message}`, { nonRetryable: true });
      }
      validateMediaReceipt({ receipt, receiptType, task, requestFingerprint, attempt });
      entry[receiptType] = receipt;
    }
    receipts.push(entry);
  }
  return receipts;
}

async function writeMediaOutcomeReceipt({
  assetStore,
  task,
  requestFingerprint,
  attempt,
  receiptType,
  outcome,
  providerCalls,
  providerStatuses,
  checksum = null,
  bytes = null,
}) {
  const receipt = {
    schemaVersion: MEDIA_RECEIPT_SCHEMA_VERSION,
    receiptType,
    taskId: task.taskId,
    idempotencyKey: task.idempotencyKey || task.taskId,
    requestFingerprint,
    outputStorageKey: task.output.storageKey,
    attempt,
    outcome,
    providerCalls: Math.max(0, Number(providerCalls) || 0),
    providerStatuses: (providerStatuses || []).slice(0, 12),
    ...(checksum ? { checksum } : {}),
    ...(Number.isFinite(Number(bytes)) ? { bytes: Number(bytes) } : {}),
    createdAt: new Date().toISOString(),
    providerMutations: 0,
  };
  const stored = await assetStore.putObjectIfAbsent({
    storageKey: mediaReceiptKey(task, attempt, receiptType),
    bytes: Buffer.from(JSON.stringify(receipt, null, 2)),
    contentType: 'application/json',
  });
  if (stored.created === false) {
    const existing = JSON.parse(Buffer.from(await assetStore.getObject(mediaReceiptKey(task, attempt, receiptType))).toString('utf8'));
    validateMediaReceipt({ receipt: existing, receiptType, task, requestFingerprint, attempt });
    if (JSON.stringify(receiptIdentity(existing)) !== JSON.stringify(receiptIdentity(receipt))) {
      throw new Error(`Durable media ${receiptType} receipt conflicts with the existing outcome.`);
    }
  }
  return receipt;
}

function validateMediaReceipt({ receipt, receiptType, task, requestFingerprint, attempt }) {
  if (receipt?.schemaVersion !== MEDIA_RECEIPT_SCHEMA_VERSION
    || receipt?.receiptType !== receiptType
    || receipt?.taskId !== task.taskId
    || receipt?.idempotencyKey !== (task.idempotencyKey || task.taskId)
    || receipt?.requestFingerprint !== requestFingerprint
    || receipt?.outputStorageKey !== task.output.storageKey
    || Number(receipt?.attempt) !== Number(attempt)) {
    throw mediaTaskError(`Durable media ${receiptType} receipt is stale or invalid.`, { nonRetryable: true });
  }
}

function mediaReceiptKey(task, attempt, receiptType) {
  return `${task.output.storageKey}.attempt-${attempt}.${receiptType}.json`;
}

function providerCallsRecordedByReceipts(receipts) {
  return receipts.reduce((total, entry) => {
    if (entry.success) return total + Math.max(0, Number(entry.success.providerCalls) || 0);
    if (entry.failure) return total + Math.max(0, Number(entry.failure.providerCalls) || 0);
    if (entry.intent) return total + Math.max(1, Number(entry.intent.maxProviderCalls) || 1);
    return total;
  }, 0);
}

function unaccountedProviderCalls(task, receipts) {
  const recorded = Math.max(0, Number(task?.usage?.generationProviderCalls) || 0);
  return Math.max(0, providerCallsRecordedByReceipts(receipts) - recorded);
}

function mediaRequestFingerprint({ task, source }) {
  const payload = {
    taskId: task.taskId,
    idempotencyKey: task.idempotencyKey || task.taskId,
    adapter: task.adapter || null,
    outputType: task.outputType || null,
    spec: task.spec || {},
    output: task.output || {},
    source: source || {},
  };
  return sha256(Buffer.from(JSON.stringify(sortReceiptValue(payload))));
}

function sortReceiptValue(value) {
  if (Array.isArray(value)) return value.map(sortReceiptValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortReceiptValue(value[key])]));
}

function providerStatuses(error) {
  return (Array.isArray(error?.attempts) ? error.attempts : [])
    .map((attempt) => Number.isFinite(Number(attempt?.status)) ? Number(attempt.status) : null)
    .slice(0, 12);
}

function definitiveProviderFailure(error, actualCalls) {
  if (actualCalls === 0) return true;
  const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
  return attempts.length > 0 && attempts.every((attempt) => attempt?.status !== null && attempt?.status !== undefined);
}

function receiptIdentity(receipt) {
  return {
    receiptType: receipt.receiptType,
    taskId: receipt.taskId,
    requestFingerprint: receipt.requestFingerprint,
    attempt: receipt.attempt,
    outcome: receipt.outcome,
    providerCalls: receipt.providerCalls,
    checksum: receipt.checksum || null,
  };
}

function mediaResult({ task, asset, providerCalls, reusedArtifact }) {
  return {
    asset: { ...asset, reusedArtifact },
    costUnits: task.costUnits,
    providerCalls: Math.max(0, Number(providerCalls) || 0),
    reusedArtifact,
    providerMutations: 0,
  };
}

function mediaTaskError(message, { providerCalls = 0, nonRetryable = false } = {}) {
  const error = neutralError(message, { providerCalls });
  error.nonRetryable = nonRetryable;
  return error;
}

/* Source-layer prompt: a canvas for the finishing compositor. Deliberately
   forbids UI, text, and claims so nothing factual is fabricated upstream of
   the proof-backed finishing pass. */
function imageSourcePrompt({ task, source }) {
  const style = (source.styleNotes || []).join('; ') || 'clean, modern, high-contrast';
  const angle = task.spec.claimText
    ? `The ad this feeds will be about: "${task.spec.claimText}".`
    : `The ad this feeds promotes the mobile app ${source.appName}.`;
  return [
    `Create a vertical ${task.spec.dimensions.width}x${task.spec.dimensions.height} background canvas for a mobile app advertisement.`,
    angle,
    `Mood/style: ${style}.`,
    'Composition requirements:',
    '- Leave the top quarter visually calm for a headline that will be added later.',
    '- Leave the center-right region low-detail so a real phone screenshot panel can be placed there later.',
    '- Photographic or softly graphic lifestyle scene that fits the app category.',
    'Hard rules: absolutely NO text, NO letters, NO numbers, NO logos, NO watermarks, NO phone screens, NO app interfaces, NO fake UI, and NO readable signage anywhere in the image.',
  ].join('\n');
}

function creatorFirstFramePrompt({ task, source }) {
  const identity = task.spec.creatorIdentity?.description
    ? `Creator identity: ${task.spec.creatorIdentity.description}.`
    : `Creator should feel like a real user of ${source.appName}.`;
  const continuity = task.spec.visualContinuity
    ? visualContinuityPrompt(task.spec.visualContinuity)
    : 'Lock the face, outfit, background, camera distance, lighting, and stable props for later video clips.';
  return [
    task.spec.firstFramePrompt || 'Vertical 9:16 paused first frame from a handheld iPhone front-camera video in an ordinary room.',
    identity,
    continuity,
    'This image will be reused as the starting visual reference for every creator clip in the same ad, so make the face clear, stable, and realistic.',
    'One adult creator only. Ordinary phone selfie frame, natural skin texture, imperfect crop, flat everyday light, no studio or influencer polish.',
    'The recording phone is the camera and stays completely out of frame. The creator is not holding, showing, or looking at any second phone or device.',
    'Hard rules: no visible phone or device, no visible writing, no captions, no subtitles, no logos, no watermarks, no app interface, no phone screen, no duplicate person, no duplicate seatbelt or strap.',
  ].join('\n');
}

function creatorSegmentPrompt({ task, source, requestedDurationSeconds = null, hasReferenceImage = false }) {
  const line = task.spec.spokenLine || `I have been using ${source.appName} every day.`;
  const role = task.spec.segmentRole || 'creator';
  const exactSentences = exactSentencePrompt(task.spec.scriptBeats, line);
  const firstFrame = task.spec.firstFramePrompt || 'Vertical 9:16 paused first frame from a handheld iPhone front-camera video in an ordinary room. Imperfect crop, flat light, mild social compression, natural skin texture, background mostly readable.';
  const creatorIdentity = task.spec.creatorIdentity?.description
    ? `Use this exact recurring creator identity for continuity across the whole ad: ${task.spec.creatorIdentity.description}. The hook, proof-voice, and reaction clips must look like the same person in the same place with the same outfit, hair, face shape, skin details, and phone camera setup.`
    : 'Keep the creator identity stable across every beat in this ad.';
  const visualContinuity = task.spec.visualContinuity
    ? visualContinuityPrompt(task.spec.visualContinuity)
    : 'Preserve the same face, outfit, camera angle, background, props, and lighting for the whole clip.';
  const beatDirection = {
    single_take: 'Record one continuous creator take that carries the whole thought: hook, proof explanation, then casual app-name reveal. It must feel like one uninterrupted voice-note, not separate ad blocks. Keep the energy quick and conversational.',
    hook: 'Open with a direct target-viewer callout, like the creator just hit record because a specific kind of person needs to hear this. Keep the app name out of this beat.',
    tension_bridge: 'Name the specific annoying behavior, then pivot into the useful realization. It should sound like a confession with momentum, not a feature list. Keep the app name out of this beat.',
    proof_voice: 'Keep speaking naturally while the final compositor will cut to real app proof. Describe only what the visible app proof can support. Do not look at or show a phone screen.',
    reaction: 'Land with a personal takeaway, then a casual app-name reveal and behavioral CTA. It should feel like advice to a friend, not a hard sales CTA.',
  }[role] || 'Speak like an ordinary creator, not a presenter.';
  const startSeconds = Number(task.spec.startSeconds);
  const mustCompleteBySeconds = Number(task.spec.mustCompleteBySeconds);
  const tailRoomSeconds = Number(task.spec.tailRoomSeconds || 1);
  const clipSeconds = Number(requestedDurationSeconds);
  const requiresCompleteLineTiming = Boolean(role);
  const effectiveTailRoomSeconds = role === 'hook' ? 0.35 : ['reaction', 'single_take'].includes(role) ? tailRoomSeconds : 0.35;
  const finishByClipSeconds = requiresCompleteLineTiming && Number.isFinite(clipSeconds) && clipSeconds > effectiveTailRoomSeconds
    ? clipSeconds - effectiveTailRoomSeconds
    : Number.isFinite(startSeconds) && Number.isFinite(mustCompleteBySeconds)
    ? Math.max(0.5, mustCompleteBySeconds - startSeconds)
    : null;
  const timingDirection = finishByClipSeconds
    ? role === 'hook'
      ? `Finish the complete hook sentence within the first ${finishByClipSeconds.toFixed(1)} seconds of this clip. Leave the final fraction of a second for a natural closed-mouth landing. Do not trail off, cut the last word, or keep talking into the ending.`
      : ['reaction', 'single_take'].includes(role)
        ? `Finish the complete sentence, including the full app name, within the first ${finishByClipSeconds.toFixed(1)} seconds of this clip. Then leave about ${tailRoomSeconds.toFixed(1)} seconds of natural silent reaction before the clip ends. Do not trail off or keep talking into the ending.`
        : `Finish every exact sentence within the first ${finishByClipSeconds.toFixed(1)} seconds of this clip. Leave the final fraction of a second for a natural landing. Do not trail off, cut the last words, or keep talking into the ending.`
    : null;
  return [
    'Vertical 9:16 selfie video that feels like an ordinary iPhone front-camera recording, not a polished ad.',
    ...(hasReferenceImage ? ['Use the provided image as the exact first frame and visual anchor for this clip. Preserve that same person, outfit, seatbelt/props, background layout, camera side, and lighting from frame one.'] : []),
    firstFrame,
    creatorIdentity,
    visualContinuity,
    'Preserve the awkward phone-frame realism: no portrait mode, no creamy bokeh, no studio lighting, no beauty polish, no perfect centered headshot, no cinematic camera move.',
    'One adult creator only, casual clothes, natural pores/flyaway hair/fabric texture, mild compression, flat everyday light.',
    beatDirection,
    ...(timingDirection ? [timingDirection] : []),
    exactSentences,
    'Do not paraphrase, reorder, add filler words, or replace any sentence. Keep the sentence breaks audible, with a quick natural pause after each period.',
    'Natural mouth movement matching the words, subtle head motion, tiny imperfect pauses, no cuts, no jump cuts, no zooms, no scene changes, no visual reset between phrases.',
    'The recording phone is the camera and stays completely out of frame. The creator must not hold, show, or look at any second phone or device.',
    'Hard rules: no visible phone or device. The generated source video itself must contain ZERO visible writing: no on-screen text, no captions, no subtitles, no lower-thirds, no karaoke words, no random letters, no logos, no watermarks, no phone screens or app interfaces visible. Only the creator audio should carry the words.',
  ].join('\n');
}

function exactSentencePrompt(scriptBeats, fallbackLine) {
  const beats = Array.isArray(scriptBeats) ? scriptBeats.filter((beat) => beat?.dialogue) : [];
  if (!beats.length) return `The creator says exactly: "${fallbackLine}"`;
  return [
    'The creator says these exact short sentences in order:',
    ...beats.map((beat, index) => `${index + 1}. "${beat.dialogue}"`),
  ].join('\n');
}

function visualContinuityPrompt(continuity = {}) {
  const stableProps = Array.isArray(continuity.stableProps) && continuity.stableProps.length
    ? `Stable visible details that must not change: ${continuity.stableProps.join('; ')}.`
    : 'Stable visible details must not change: outfit, background, lighting, camera distance, and props.';
  const forbidden = Array.isArray(continuity.forbiddenDrift) && continuity.forbiddenDrift.length
    ? `Do not introduce: ${continuity.forbiddenDrift.join('; ')}.`
    : 'Do not introduce new props, changed clothing, changed background, or changed lighting.';
  const singleTake = continuity.mode === 'single_take_locked_frame'
    ? 'This is a single uninterrupted take from one fixed selfie setup. The first and last frame should plausibly be moments from the same recording.'
    : 'Every frame should preserve the locked creator setup.';
  return [singleTake, stableProps, forbidden].join(' ');
}

function liveAssetRecord({ task, kind, stored, width = null, height = null, durationSeconds = null, mediaValidation = 'parsed' }) {
  return {
    assetId: `${task.taskId}-asset`,
    taskId: task.taskId,
    jobId: task.jobId,
    packId: task.packId,
    orgId: task.orgId,
    workspaceId: task.workspaceId,
    appId: task.appId,
    kind,
    storageKey: stored.storageKey,
    contentType: stored.contentType,
    width,
    height,
    durationSeconds,
    bytes: stored.bytes,
    checksum: stored.checksum,
    mode: 'live_source',
    mediaValidation,
    providerMutations: 0,
  };
}

function aspectRatioFor(dimensions = {}) {
  const { width, height } = dimensions;
  if (!width || !height) return '4:5';
  const ratio = width / height;
  if (Math.abs(ratio - 4 / 5) < 0.02) return '4:5';
  if (Math.abs(ratio - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(ratio - 1) < 0.02) return '1:1';
  if (Math.abs(ratio - 16 / 9) < 0.02) return '16:9';
  return '4:5';
}

function neutralError(message, { providerCalls = 0, planningProviderCalls = 0 } = {}) {
  const error = new Error(message);
  error.providerCalls = Number(providerCalls) || 0;
  error.planningProviderCalls = Number(planningProviderCalls) || 0;
  return error;
}

function round2(value) {
  return value === null || value === undefined ? null : Math.round(value * 100) / 100;
}
