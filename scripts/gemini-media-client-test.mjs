#!/usr/bin/env node

import assert from 'node:assert/strict';

import { createGeminiMediaClient } from '../lib/providers/gemini-media.mjs';

const sourceImage = Buffer.from('reference-image-bytes');
const videoBytes = Buffer.from('omni-video-bytes');
const calls = [];

const client = createGeminiMediaClient({
  apiKey: 'in-memory-test-key',
  fetchImpl: async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({
      id: 'interaction-test-1',
      status: 'completed',
      model: 'gemini-omni-flash-preview',
      steps: [
        { type: 'user_input', content: [{ type: 'text', text: 'input' }] },
        {
          type: 'model_output',
          content: [{ type: 'video', mime_type: 'video/mp4', data: videoBytes.toString('base64') }],
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});

const result = await client.generateVideo({
  prompt: 'One continuous creator shot with natural speech.',
  aspectRatio: '9:16',
  durationSeconds: 8,
  negativePrompt: 'no visible phone, no text',
  referenceImage: { bytes: sourceImage, mimeType: 'image/png' },
});

assert.deepEqual(result.bytes, videoBytes);
assert.equal(result.mimeType, 'video/mp4');
assert.equal(result.model, 'gemini-omni-flash-preview');
assert.equal(result.interactionId, 'interaction-test-1');
assert.equal(calls.length, 1);
assert.match(calls[0].url, /\/v1beta\/interactions$/);
assert.equal(calls[0].init.method, 'POST');
assert.equal(calls[0].body.model, 'gemini-omni-flash-preview');
assert.deepEqual(calls[0].body.response_format, { type: 'video', aspect_ratio: '9:16' });
assert.deepEqual(calls[0].body.generation_config, { video_config: { task: 'image_to_video' } });
assert.equal(calls[0].body.store, false);
assert.equal(calls[0].body.background, false);
assert.equal(calls[0].body.stream, false);
assert.equal(calls[0].body.input[0].type, 'image');
assert.equal(calls[0].body.input[0].mime_type, 'image/png');
assert.equal(Buffer.from(calls[0].body.input[0].data, 'base64').toString(), sourceImage.toString());
assert.match(calls[0].body.input[1].text, /<FIRST_FRAME>/);
assert.match(calls[0].body.input[1].text, /about 8 seconds/);
assert.match(calls[0].body.input[1].text, /no visible phone, no text/);

console.log('Gemini Omni media client contract tests passed');
console.log(JSON.stringify({ model: result.model, requests: calls.length, providerMutations: 0 }, null, 2));
