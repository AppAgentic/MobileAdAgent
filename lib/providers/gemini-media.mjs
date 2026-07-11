/* Server-only media generation client (Google generative media APIs).

   This module is the ONLY place that speaks provider model names for source
   generation. It must never be imported by customer-facing payload builders;
   adapters translate its results into neutral asset records.

   Key handling: the API key lives in memory on the client instance. It is
   never logged, never written to disk, and never included in errors. All
   errors surfaced from here strip the key from URLs/messages. */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash';
const DEFAULT_VIDEO_MODEL = 'gemini-omni-flash-preview';

const IMAGE_MODEL_CANDIDATES = [
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image',
];

export function createGeminiMediaClient({ apiKey, fetchImpl = fetch, onCall = () => {}, timeoutMs = 120_000 } = {}) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('Media generation client needs an API key (in memory only).');
  }

  async function request(pathname, { method = 'GET', body, kind = 'metadata', label } = {}) {
    const startedAtMs = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${API_BASE}/${pathname}`, {
        method,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      onCall({
        kind,
        label: label || pathname.split('?')[0],
        method,
        status: response.status,
        durationMs: Math.max(0, Date.now() - startedAtMs),
      });
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { raw: text.slice(0, 400) };
      }
      return { status: response.status, ok: response.ok, payload };
    } catch (error) {
      onCall({
        kind,
        label: label || pathname.split('?')[0],
        method,
        status: null,
        outcome: error?.name === 'AbortError' ? 'timeout' : 'transport_error',
        durationMs: Math.max(0, Date.now() - startedAtMs),
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function listModels() {
    const result = await request('models?pageSize=1000', { kind: 'metadata', label: 'models.list' });
    if (!result.ok) {
      throw providerError('models.list', result);
    }
    return result.payload?.models || [];
  }

  async function generateJson({ prompt, schema, model = DEFAULT_TEXT_MODEL, label = 'structured.generate' } = {}) {
    if (!prompt || !schema) throw new Error('Structured generation needs a prompt and JSON schema.');
    const result = await request('interactions', {
      method: 'POST',
      kind: 'intelligence',
      label: `${label}:${model}`,
      body: {
        model,
        store: false,
        input: prompt,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema,
        },
      },
    });
    if (!result.ok) throw providerError(label, result);
    const text = structuredOutputText(result.payload);
    if (!text) throw new Error(`${label} returned no structured text.`);
    return parseStructuredJson(text, label);
  }

  async function generateImage({ prompt, aspectRatio = '4:5', model, inputImages = [] } = {}) {
    const candidates = model ? [model] : IMAGE_MODEL_CANDIDATES;
    const references = normalizeInputImages(inputImages);
    const attempts = [];
    for (const candidate of candidates) {
      const bodyAttempts = [
        buildImageGenerationBody({ prompt, aspectRatio, inputImages: references, responseModalities: ['IMAGE'], inlineStyle: 'camel' }),
      ];
      if (references.length) {
        bodyAttempts.push(buildImageGenerationBody({ prompt, aspectRatio, inputImages: references, responseModalities: ['IMAGE'], inlineStyle: 'snake' }));
      }
      // Some image models require TEXT alongside IMAGE modalities.
      bodyAttempts.push(buildImageGenerationBody({ prompt, aspectRatio, inputImages: references, responseModalities: ['TEXT', 'IMAGE'], inlineStyle: 'camel' }));
      if (references.length) {
        bodyAttempts.push(buildImageGenerationBody({ prompt, aspectRatio, inputImages: references, responseModalities: ['TEXT', 'IMAGE'], inlineStyle: 'snake' }));
      }

      let result = null;
      for (const body of bodyAttempts) {
        result = await request(`models/${candidate}:generateContent`, {
          method: 'POST', body, kind: 'generation', label: `image.generate:${candidate}`,
        });
        if (result.ok || result.status !== 400) break;
      }
      if (result.ok) {
        const inline = extractInlineImage(result.payload);
        if (inline) {
          return { bytes: Buffer.from(inline.data, 'base64'), mimeType: inline.mimeType || 'image/png', model: candidate };
        }
        attempts.push({ model: candidate, status: result.status, error: 'Response contained no inline image data.' });
        continue;
      }
      attempts.push({ model: candidate, status: result.status, error: apiErrorMessage(result) });
      // 404/permission errors: try the next candidate model; others give up.
      if (![404, 403, 429].includes(result.status)) break;
    }
    const error = new Error(`Image generation failed across ${attempts.length} model candidate(s).`);
    error.attempts = attempts;
    throw error;
  }

  async function generateVideo({ prompt, aspectRatio = '9:16', durationSeconds, negativePrompt, referenceImage = null, model = DEFAULT_VIDEO_MODEL } = {}) {
    const promptText = [
      referenceImage?.bytes ? '<FIRST_FRAME> Use the supplied image as the exact starting frame and identity anchor.' : null,
      prompt,
      durationSeconds ? `Target a concise source clip of about ${durationSeconds} seconds.` : null,
      negativePrompt ? `Avoid these failure modes: ${negativePrompt}` : null,
      referenceImage?.bytes ? 'Use the supplied image as the starting frame. Keep the same person, clothing, setting, crop, and lighting.' : null,
    ].filter(Boolean).join('\n');
    const input = referenceImage?.bytes
      ? [
        {
          type: 'image',
          data: Buffer.from(referenceImage.bytes).toString('base64'),
          mime_type: referenceImage.mimeType || 'image/png',
        },
        { type: 'text', text: promptText },
      ]
      : promptText;
    const result = await request('interactions', {
      method: 'POST',
      kind: 'generation',
      label: `video.generate:${model}`,
      body: {
        model,
        store: false,
        background: false,
        stream: false,
        input,
        response_format: { type: 'video', aspect_ratio: aspectRatio },
        generation_config: {
          video_config: {
            task: referenceImage?.bytes ? 'image_to_video' : 'text_to_video',
          },
        },
      },
    });
    if (!result.ok) {
      const error = new Error(`Video generation request was rejected (HTTP ${result.status}).`);
      error.attempts = [{ model, status: result.status, error: apiErrorMessage(result) }];
      throw error;
    }
    const video = extractInteractionVideo(result.payload);
    if (video?.data) {
      return {
        bytes: Buffer.from(video.data, 'base64'),
        mimeType: video.mimeType || 'video/mp4',
        model,
        interactionId: result.payload?.id || null,
      };
    }
    if (video?.uri) {
      return {
        bytes: await downloadVideo(video.uri),
        mimeType: video.mimeType || 'video/mp4',
        model,
        interactionId: result.payload?.id || null,
      };
    }
    const error = new Error('Video generation interaction finished without a retrievable video.');
    error.attempts = [{ model, status: result.status, error: `interaction status: ${result.payload?.status || 'unknown'}` }];
    throw error;
  }

  async function downloadVideo(uri) {
    const url = new URL(uri);
    url.searchParams.delete('key');
    const response = await fetchImpl(url.href, { headers: { 'x-goog-api-key': apiKey } });
    onCall({ kind: 'metadata', label: 'video.download', method: 'GET', status: response.status });
    if (!response.ok) {
      throw new Error(`Video download failed (HTTP ${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return { listModels, generateJson, generateImage, generateVideo };
}

function buildImageGenerationBody({ prompt, aspectRatio, inputImages, responseModalities, inlineStyle }) {
  const parts = [{ text: prompt }];
  for (const image of inputImages) {
    parts.push(imageInputPart(image, inlineStyle));
  }
  return {
    contents: [{ parts }],
    generationConfig: {
      responseModalities,
      imageConfig: { aspectRatio },
    },
  };
}

function normalizeInputImages(inputImages) {
  if (!inputImages) return [];
  return (Array.isArray(inputImages) ? inputImages : [inputImages]).map((image, index) => {
    const bytes = image?.bytes ? Buffer.from(image.bytes) : null;
    if (!bytes?.byteLength) {
      throw new Error(`Image generation input ${index + 1} is missing bytes.`);
    }
    return {
      bytes,
      mimeType: image.mimeType || 'image/png',
    };
  });
}

function imageInputPart(image, inlineStyle) {
  const data = Buffer.from(image.bytes).toString('base64');
  if (inlineStyle === 'snake') {
    return { inline_data: { mime_type: image.mimeType || 'image/png', data } };
  }
  return { inlineData: { mimeType: image.mimeType || 'image/png', data } };
}

function extractInlineImage(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) return { data: inline.data, mimeType: inline.mimeType || inline.mime_type };
  }
  return null;
}

function structuredOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  if (typeof payload?.text === 'string') return payload.text;
  if (typeof payload?.response?.text === 'string') return payload.response.text;
  const parts = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.text === 'string') parts.push(value.text);
    if (typeof value.output_text === 'string') parts.push(value.output_text);
    for (const key of ['parts', 'content', 'output', 'steps', 'candidates']) {
      if (Array.isArray(value[key])) value[key].forEach(visit);
    }
  };
  visit(payload);
  return parts.join('').trim();
}

function extractInteractionVideo(payload) {
  for (const step of payload?.steps || []) {
    for (const item of step?.content || []) {
      if (item?.type !== 'video') continue;
      return {
        data: item.data || null,
        uri: item.uri || null,
        mimeType: item.mime_type || item.mimeType || 'video/mp4',
      };
    }
  }
  return null;
}

function parseStructuredJson(text, label) {
  const raw = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(raw);
  } catch {
    const object = raw.match(/\{[\s\S]*\}/);
    if (object) return JSON.parse(object[0]);
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function apiErrorMessage(result) {
  const message = result.payload?.error?.message || result.payload?.raw || 'no error body';
  return String(message).replace(/key=[\w-]+/gi, 'key=REDACTED').slice(0, 500);
}

function providerError(label, result) {
  const error = new Error(`${label} failed (HTTP ${result.status}).`);
  error.attempts = [{ model: null, status: result.status, error: apiErrorMessage(result) }];
  return error;
}
