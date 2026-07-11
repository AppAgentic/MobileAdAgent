#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLocalAssetStore } from '../lib/asset-store.mjs';
import { chooseCreatorClipDurationSeconds, createLiveGenerationAdapters } from '../lib/live-generation.mjs';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function mp4Box(type, payload) {
  const body = Buffer.from(payload);
  const box = Buffer.alloc(8 + body.byteLength);
  box.writeUInt32BE(box.byteLength, 0);
  box.write(type, 4, 4, 'ascii');
  body.copy(box, 8);
  return box;
}

function minimalMp4() {
  const ftyp = mp4Box('ftyp', Buffer.from('isom0000', 'ascii'));
  const mvhdBody = Buffer.alloc(20);
  mvhdBody.writeUInt8(0, 0);
  mvhdBody.writeUInt32BE(1_000, 12);
  mvhdBody.writeUInt32BE(4_032, 16);
  const track = (handlerType, duration) => {
    const mdhdBody = Buffer.alloc(20);
    mdhdBody.writeUInt8(0, 0);
    mdhdBody.writeUInt32BE(1_000, 12);
    mdhdBody.writeUInt32BE(duration, 16);
    const hdlrBody = Buffer.alloc(12);
    hdlrBody.write(handlerType, 8, 4, 'ascii');
    return mp4Box('trak', mp4Box('mdia', Buffer.concat([
      mp4Box('mdhd', mdhdBody),
      mp4Box('hdlr', hdlrBody),
    ])));
  };
  return Buffer.concat([ftyp, mp4Box('moov', Buffer.concat([
    mp4Box('mvhd', mvhdBody),
    track('vide', 4_000),
    track('soun', 4_032),
  ]))]);
}

assert.equal(chooseCreatorClipDurationSeconds({
  task: { spec: { startSeconds: 0, endSeconds: 4, spokenLine: 'Writing a massive to-do list does not work when everything looks urgent.' } },
}), 6, 'a 12-word hook must receive a six-second source clip instead of truncating at four seconds');
assert.equal(chooseCreatorClipDurationSeconds({
  task: { spec: { startSeconds: 12, endSeconds: 20, spokenLine: 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six.' } },
}), 10, 'a 26-word proof block must receive a ten-second source clip instead of truncating at eight seconds');

const source = {
  appId: 'app-durable-media',
  appName: 'Durable Media Test',
  appSummary: 'A reviewed app used only by the no-network durability test.',
  styleNotes: ['Plain source layer'],
};

function taskFixture({ taskId, outputType, storageKey, spec, attempt = 1, usage = 0, costUnits = 10 }) {
  return {
    taskId,
    jobId: 'job-durable-media',
    packId: 'pack-durable-media',
    orgId: 'org-durable-media',
    workspaceId: 'ws-durable-media',
    appId: source.appId,
    adapter: outputType,
    outputType,
    idempotencyKey: `job-durable-media:${taskId}`,
    attempts: attempt,
    usage: { planningProviderCalls: 0, generationProviderCalls: usage, providerMutations: 0 },
    costUnits,
    spec,
    output: {
      storageKey,
      contentType: outputType === 'ugc_segment' ? 'video/mp4' : 'image/png',
    },
  };
}

function adaptersWithFakeClient({ assetStore, behavior }) {
  return createLiveGenerationAdapters({
    env: {},
    secretResolver: async () => 'in-memory-test-key',
    assetStore,
    mediaClientFactory: ({ onCall }) => ({
      async generateJson() {
        throw new Error('The media durability test must not call structured intelligence.');
      },
      async generateImage(input) {
        return behavior.generateImage({ input, onCall });
      },
      async generateVideo(input) {
        return behavior.generateVideo({ input, onCall });
      },
    }),
  });
}

function successfulBehavior(counter) {
  return {
    async generateImage({ onCall }) {
      counter.image += 1;
      onCall({ kind: 'generation', label: 'test.image', method: 'POST', status: 200 });
      return { bytes: onePixelPng, mimeType: 'image/png', model: 'test-image' };
    },
    async generateVideo({ onCall }) {
      counter.video += 1;
      onCall({ kind: 'generation', label: 'test.video', method: 'POST', status: 200 });
      return { bytes: minimalMp4(), mimeType: 'video/mp4', model: 'test-video' };
    },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'maa-live-media-durability-'));
try {
  const baseStore = createLocalAssetStore({ rootDir: root });
  const counter = { image: 0, video: 0 };
  const adapters = adaptersWithFakeClient({ assetStore: baseStore, behavior: successfulBehavior(counter) });
  const cases = [
    {
      name: 'image ad source',
      task: taskFixture({
        taskId: 'image-source',
        outputType: 'image_ad_source',
        storageKey: 'jobs/durable/generated/image-source.png',
        spec: { dimensions: { width: 1080, height: 1350 }, claimText: 'Reviewed claim' },
        costUnits: 4,
      }),
      run: (task) => adapters.imageAd.generateImageAd({ task, source }),
      counter: () => counter.image,
    },
    {
      name: 'UGC first frame',
      task: taskFixture({
        taskId: 'ugc-frame',
        outputType: 'ugc_first_frame',
        storageKey: 'jobs/durable/generated/ugc-frame.png',
        spec: { dimensions: { width: 1080, height: 1920 }, creatorIdentity: { description: 'One adult creator' } },
      }),
      run: (task) => adapters.ugcFirstFrame.generateFirstFrame({ task, source }),
      counter: () => counter.image,
    },
    {
      name: 'UGC segment',
      task: taskFixture({
        taskId: 'ugc-segment',
        outputType: 'ugc_segment',
        storageKey: 'jobs/durable/generated/ugc-segment.mp4',
        spec: {
          dimensions: { width: 1080, height: 1920 },
          startSeconds: 0,
          endSeconds: 4,
          segmentRole: 'hook',
          spokenLine: 'A source-backed hook for the durability test.',
        },
      }),
      run: (task) => adapters.ugcSegment.generateSegment({ task, source, inputAssets: [] }),
      counter: () => counter.video,
    },
  ];

  for (const fixture of cases) {
    const before = fixture.counter();
    const first = await fixture.run(fixture.task);
    assert.equal(fixture.counter(), before + 1, `${fixture.name} must call its provider once initially`);
    assert.equal(first.reusedArtifact, false);
    assert.equal(first.providerCalls, 1);
    assert.ok(first.asset.checksum);

    // Simulates a worker dying after the object write but before the task
    // result is committed: the next lease has no recorded usage yet.
    const recoveredTask = taskFixture({
      ...fixture.task,
      taskId: fixture.task.taskId,
      outputType: fixture.task.outputType,
      storageKey: fixture.task.output.storageKey,
      spec: fixture.task.spec,
      attempt: 2,
      usage: 0,
      costUnits: fixture.task.costUnits,
    });
    const recovered = await fixture.run(recoveredTask);
    assert.equal(fixture.counter(), before + 1, `${fixture.name} retry must not call its provider again`);
    assert.equal(recovered.reusedArtifact, true);
    assert.equal(recovered.providerCalls, 1);
    assert.equal(recovered.asset.checksum, first.asset.checksum);
  }

  /* A definite HTTP failure is receipted and may use the next bounded task
     attempt. The already-accounted first call is not double-counted. */
  const definitiveCounter = { image: 0, video: 0 };
  let rejectFirst = true;
  const definitiveBehavior = successfulBehavior(definitiveCounter);
  definitiveBehavior.generateImage = async ({ onCall }) => {
    definitiveCounter.image += 1;
    if (rejectFirst) {
      rejectFirst = false;
      onCall({ kind: 'generation', label: 'test.image', method: 'POST', status: 503 });
      const error = new Error('Provider returned a definite HTTP failure.');
      error.attempts = [{ status: 503 }];
      throw error;
    }
    onCall({ kind: 'generation', label: 'test.image', method: 'POST', status: 200 });
    return { bytes: onePixelPng, mimeType: 'image/png', model: 'test-image' };
  };
  const definitiveStore = createLocalAssetStore({ rootDir: path.join(root, 'definitive') });
  const definitiveAdapters = adaptersWithFakeClient({ assetStore: definitiveStore, behavior: definitiveBehavior });
  const definitiveTask = taskFixture({
    taskId: 'definitive-image',
    outputType: 'image_ad_source',
    storageKey: 'jobs/definitive/generated/image.png',
    spec: { dimensions: { width: 1080, height: 1350 }, claimText: 'Reviewed claim' },
    costUnits: 4,
  });
  let definiteError = null;
  try {
    await definitiveAdapters.imageAd.generateImageAd({ task: definitiveTask, source });
  } catch (error) {
    definiteError = error;
  }
  assert.ok(definiteError);
  assert.equal(definiteError.nonRetryable, false);
  assert.equal(definiteError.providerCalls, 1);
  const definitiveRetry = {
    ...definitiveTask,
    attempts: 2,
    usage: { ...definitiveTask.usage, generationProviderCalls: 1 },
  };
  const definitiveResult = await definitiveAdapters.imageAd.generateImageAd({ task: definitiveRetry, source });
  assert.equal(definitiveCounter.image, 2);
  assert.equal(definitiveResult.providerCalls, 1);
  assert.equal(definitiveResult.reusedArtifact, false);

  /* Once a provider call began but its source object could not be persisted,
     the next attempt fails closed instead of paying for a duplicate call. */
  const ambiguousCounter = { image: 0, video: 0 };
  const ambiguousBaseStore = createLocalAssetStore({ rootDir: path.join(root, 'ambiguous') });
  const ambiguousTask = taskFixture({
    taskId: 'ambiguous-frame',
    outputType: 'ugc_first_frame',
    storageKey: 'jobs/ambiguous/generated/frame.png',
    spec: { dimensions: { width: 1080, height: 1920 }, creatorIdentity: { description: 'One adult creator' } },
  });
  const failingOutputStore = {
    ...ambiguousBaseStore,
    async putObjectIfAbsent(input) {
      if (input.storageKey === ambiguousTask.output.storageKey) {
        throw new Error('simulated output-store outage');
      }
      return ambiguousBaseStore.putObjectIfAbsent(input);
    },
  };
  const ambiguousAdapters = adaptersWithFakeClient({ assetStore: failingOutputStore, behavior: successfulBehavior(ambiguousCounter) });
  let ambiguousFirstError = null;
  try {
    await ambiguousAdapters.ugcFirstFrame.generateFirstFrame({ task: ambiguousTask, source });
  } catch (error) {
    ambiguousFirstError = error;
  }
  assert.ok(ambiguousFirstError);
  assert.equal(ambiguousFirstError.nonRetryable, true);
  assert.equal(ambiguousFirstError.providerCalls, 1);
  const ambiguousRetry = {
    ...ambiguousTask,
    attempts: 2,
    usage: { ...ambiguousTask.usage, generationProviderCalls: 1 },
  };
  await assert.rejects(
    ambiguousAdapters.ugcFirstFrame.generateFirstFrame({ task: ambiguousRetry, source }),
    (error) => error.nonRetryable === true && /ambiguous/i.test(error.message),
  );
  assert.equal(ambiguousCounter.image, 1, 'ambiguous retry must make zero additional provider calls');

  /* A corrupt object at the stable output key is never accepted or
     overwritten, even when a prior intent exists. */
  await ambiguousBaseStore.putObject({
    storageKey: ambiguousTask.output.storageKey,
    bytes: Buffer.from('not media'),
    contentType: 'application/octet-stream',
  });
  await assert.rejects(
    ambiguousAdapters.ugcFirstFrame.generateFirstFrame({ task: ambiguousRetry, source }),
    (error) => error.nonRetryable === true && /failed media validation/i.test(error.message),
  );
  assert.equal(ambiguousCounter.image, 1, 'corrupt durable output must not trigger a replacement provider call');

  assert.throws(
    () => createLiveGenerationAdapters({
      secretResolver: async () => 'test',
      assetStore: { exists() {}, getObject() {}, putObject() {} },
    }),
    /conditional-create/i,
  );

  console.log('Live media durability tests passed');
  console.log(JSON.stringify({
    mediaCapabilities: 3,
    initialProviderCalls: counter.image + counter.video,
    recoveredProviderCalls: 0,
    definitiveRetryCalls: definitiveCounter.image,
    ambiguousRetryCalls: 0,
    providerMutations: 0,
  }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
