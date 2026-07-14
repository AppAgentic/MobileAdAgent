const USER_AGENT =
  'MobileAdAgentLocalPrototype/0.1 (+https://appagentic.com; local extraction preview)';

const URL_TIMEOUT_MS = 9000;
const GEMINI_TIMEOUT_MS = 14000;
const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash';

export async function extractAppFromUrl(input = {}) {
  const rawUrl = typeof input === 'string' ? input : input.url;
  const source = typeof input === 'object' && input.source ? String(input.source) : 'dashboard';
  const url = normalizeUrl(rawUrl);
  const createdAt = new Date().toISOString();
  const jobId = `extract-${stableHash(url.href).slice(0, 10)}`;

  let extraction;
  if (isAppleAppStore(url)) {
    extraction = await extractAppleAppStore(url);
  } else if (isGooglePlay(url)) {
    extraction = await extractGooglePlay(url);
  } else {
    extraction = await extractWebsite(url);
  }

  const baseExtraction = {
    schemaVersion: 'local-app-extraction.v1',
    jobId,
    source,
    url: url.href,
    createdAt,
    providerMutations: 0,
    ...extraction,
  };

  return enrichExtractionWithGemini(baseExtraction, input);
}

function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('URL is required.');
  }
  const trimmed = rawUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }
  return url;
}

function isAppleAppStore(url) {
  return /(^|\.)apps\.apple\.com$/i.test(url.hostname) || /(^|\.)itunes\.apple\.com$/i.test(url.hostname);
}

function isGooglePlay(url) {
  return /(^|\.)play\.google\.com$/i.test(url.hostname);
}

async function extractAppleAppStore(url) {
  const appId = findAppleId(url);
  if (!appId) {
    throw new Error('Could not find an App Store app id in that URL.');
  }

  const country = countryFromAppleUrl(url) || 'us';
  const lookupUrl = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=${encodeURIComponent(country)}`;
  const lookup = await fetchJson(lookupUrl);
  const result = lookup?.results?.[0];
  if (!result) {
    throw new Error('Apple lookup returned no app for that URL.');
  }

  const screenshots = [
    ...(Array.isArray(result.screenshotUrls) ? result.screenshotUrls : []),
    ...(Array.isArray(result.ipadScreenshotUrls) ? result.ipadScreenshotUrls : []),
  ];
  const screenshotUrls = (screenshots.length ? screenshots : await extractApplePageScreenshotUrls(url))
    .map(upgradeAppleScreenshotUrl);
  const appName = cleanText(result.trackName || 'Imported App');
  const description = cleanText(result.description || '');
  const subtitle = cleanText(result.subtitle || '');
  const genre = cleanText(result.primaryGenreName || result.genres?.[0] || 'App Store');

  return buildExtraction({
    platform: 'app_store',
    app: {
      name: appName,
      bundleId: result.bundleId || null,
      seller: result.sellerName || null,
      category: genre,
      subtitle,
      price: result.formattedPrice || (result.price === 0 ? 'Free' : null),
      rating: typeof result.averageUserRating === 'number' ? result.averageUserRating : null,
      ratingCount: typeof result.userRatingCount === 'number' ? result.userRatingCount : null,
      version: result.version || null,
      iconUrl: result.artworkUrl512 || result.artworkUrl100 || null,
      storeUrl: result.trackViewUrl || null,
      summary: '',
      description,
    },
    assets: [
      result.artworkUrl512 || result.artworkUrl100
        ? asset('store-icon', 'store_icon', 'App icon', result.artworkUrl512 || result.artworkUrl100)
        : null,
      ...screenshotUrls.map((screenshotUrl, index) =>
        asset(`store-screen-${index + 1}`, 'store_screenshot', `Store screenshot ${index + 1}`, screenshotUrl)
      ),
    ].filter(Boolean),
    uiObjects: screenshotUrls.map((screenshotUrl, index) =>
      uiObject({
        id: `ui-store-screen-${index + 1}`,
        assetId: `store-screen-${index + 1}`,
        title: `Store screenshot ${index + 1}`,
        sourceType: 'store_art',
        screenType: inferScreenType(description, index),
        description: 'Store listing screenshot. Rawify before UI extraction if it is not already a clean raw app screen.',
        extractionStage: 'pre_rawification',
        requiresRawificationBeforeUiExtraction: true,
        rawifyEligible: true,
        legibility: 'unknown',
        trustLevel: 'needs_review',
        sourceUrl: screenshotUrl,
      })
    ),
    claimCandidates: [],
    styleNotes: [
      `${genre} category`,
      result.formattedPrice || result.price === 0 ? `Price: ${result.formattedPrice || 'Free'}` : null,
      'Treat store screenshots as listing material until reviewed.',
    ].filter(Boolean),
  });
}

async function extractApplePageScreenshotUrls(url) {
  const html = await fetchText(url.href);
  const urls = extractMzstaticArtworkUrls(html)
    .filter((candidate) => /\/PurpleSource/i.test(candidate))
    .filter((candidate) => !/(Placeholder|AppIcon)/i.test(candidate))
    .filter((candidate) => /\/\d+x\d+[^/]*\.(webp|jpg|png)$/i.test(candidate));
  const bestBySource = new Map();
  for (const candidate of urls) {
    const sourceKey = candidate.replace(/\/\d+x\d+[^/]*\.(webp|jpg|png)$/i, '');
    const size = imageUrlArea(candidate);
    const existing = bestBySource.get(sourceKey);
    if (!existing || size > existing.size) {
      bestBySource.set(sourceKey, { url: candidate, size });
    }
  }
  return [...bestBySource.values()]
    .sort((left, right) => right.size - left.size)
    .map((item) => item.url)
    .slice(0, 10);
}

function upgradeAppleScreenshotUrl(url) {
  return String(url || '').replace(
    /\/(\d+)x(\d+)([^/]*?)\.(webp|jpg|jpeg|png)$/i,
    (match, widthValue, heightValue, suffix, extension) => {
      const width = Number(widthValue);
      const height = Number(heightValue);
      if (!width || !height || (width >= 600 && height >= 1100)) return match;
      const ratio = height / Math.max(1, width);
      if (ratio >= 2) return `/1290x2796${suffix}.${extension}`;
      if (ratio >= 1.45) return `/1242x2208${suffix}.${extension}`;
      const scale = Math.max(600 / width, 1100 / height, 2);
      return `/${Math.round(width * scale)}x${Math.round(height * scale)}${suffix}.${extension}`;
    }
  );
}

async function extractGooglePlay(url) {
  const appId = url.searchParams.get('id') || '';
  const html = await fetchText(url.href);
  const meta = extractHtmlMeta(html);
  const appName = stripGooglePlaySuffix(meta.title || appId || 'Imported Android App');
  const description = meta.description || '';
  const screenshotUrls = extractPlayImageUrls(html).slice(0, 8);

  return buildExtraction({
    platform: 'play_store',
    app: {
      name: cleanText(appName),
      bundleId: appId || null,
      seller: null,
      category: cleanText(meta.category || 'Google Play'),
      price: null,
      rating: null,
      ratingCount: null,
      version: null,
      iconUrl: meta.image || null,
      storeUrl: url.href,
      summary: '',
      description,
    },
    assets: [
      meta.image ? asset('store-icon', 'store_icon', 'App icon', meta.image) : null,
      ...screenshotUrls.map((imageUrl, index) =>
        asset(`store-screen-${index + 1}`, 'store_screenshot', `Store screenshot ${index + 1}`, imageUrl)
      ),
    ].filter(Boolean),
    uiObjects: screenshotUrls.map((imageUrl, index) =>
      uiObject({
        id: `ui-store-screen-${index + 1}`,
        assetId: `store-screen-${index + 1}`,
        title: `Store screenshot ${index + 1}`,
        sourceType: 'store_art',
        screenType: inferScreenType(description, index),
        description: 'Google Play screenshot candidate. Rawify before UI extraction if it is not already a clean raw app screen.',
        extractionStage: 'pre_rawification',
        requiresRawificationBeforeUiExtraction: true,
        rawifyEligible: true,
        legibility: 'unknown',
        trustLevel: 'needs_review',
        sourceUrl: imageUrl,
      })
    ),
    claimCandidates: [],
    styleNotes: ['Google Play listing', 'Treat store screenshots as listing material until reviewed.'],
  });
}

async function extractWebsite(url) {
  const html = await fetchText(url.href);
  const meta = extractHtmlMeta(html);
  const name = cleanText(meta.siteName || meta.title || hostnameName(url));
  const description = cleanText(meta.description || '');

  return buildExtraction({
    platform: 'website',
    app: {
      name,
      bundleId: null,
      seller: meta.siteName || null,
      category: 'Website',
      price: null,
      rating: null,
      ratingCount: null,
      version: null,
      iconUrl: meta.image || null,
      storeUrl: url.href,
      summary: '',
      description,
    },
    assets: meta.image ? [asset('site-image', 'website_image', 'Website image', meta.image)] : [],
    uiObjects: meta.image
      ? [
          uiObject({
            id: 'ui-site-image',
            assetId: 'site-image',
            title: 'Website image',
            sourceType: 'website_asset',
            screenType: 'marketing_image',
            description: 'Website image candidate. Add app screenshots before proof-led ads.',
            rawifyEligible: false,
            legibility: 'unknown',
            trustLevel: 'context_only',
            sourceUrl: meta.image,
          }),
        ]
      : [],
    claimCandidates: [],
    styleNotes: ['Website import', 'Add app screenshots or recordings before proof-led UGC generation.'],
  });
}

function buildExtraction({ platform, app, assets, uiObjects, claimCandidates, styleNotes }) {
  return {
    platform,
    app,
    assets,
    uiObjects,
    claimCandidates,
    styleNotes,
    reviewSummary: buildReviewSummary(uiObjects, claimCandidates),
  };
}

function buildReviewSummary(uiObjects, claimCandidates) {
  const usableUiObjects = uiObjects.filter((object) => ['store_art', 'raw_app_proof'].includes(object.sourceType));
  const recommendedScreenCount = uiObjects.filter((object) => object.usability?.status === 'recommended').length;
  const reviewScreenCount = uiObjects.filter((object) => object.usability?.status === 'review').length;
  const blockedScreenCount = uiObjects.filter((object) => object.usability?.status === 'blocked').length;
  const suggestedClaims = claimCandidates.filter((claim) => claim.selected).length;
  const holds = [];

  if (!uiObjects.length) {
    holds.push({
      id: 'no-screens-found',
      severity: 'needs_action',
      message: 'No app screens were found. Add screenshots or recordings before generating proof-led ads.',
    });
  } else if (!usableUiObjects.length) {
    holds.push({
      id: 'context-only-assets',
      severity: 'needs_action',
      message: 'Only context images were found. Add app screenshots or choose a usable screen.',
    });
  } else {
    holds.push({
      id: 'review-store-art',
      severity: 'review',
      message: 'Store screenshots can guide ads, but rawify eligible listing art before UI extraction or add raw screenshots/recordings before proof-led UGC.',
    });
  }

  if (!claimCandidates.length) {
    holds.push({
      id: 'no-claims-found',
      severity: 'needs_action',
      message: 'No clear claims were extracted. Add one true product claim before generating ads.',
    });
  } else if (!suggestedClaims) {
    holds.push({
      id: 'claims-need-selection',
      severity: 'review',
      message: 'Pick or add at least one true claim before ads can use it.',
    });
  }

  return {
    screenCount: uiObjects.length,
    recommendedScreenCount,
    reviewScreenCount,
    blockedScreenCount,
    claimCount: claimCandidates.length,
    suggestedClaimCount: suggestedClaims,
    rawifyCandidateCount: uiObjects.filter((object) => object.rawifyEligible).length,
    readyForGeneration: false,
    holds,
  };
}

function asset(id, type, label, url) {
  return {
    id,
    type,
    label,
    url,
    origin: type.startsWith('store') ? 'store_listing' : 'website',
  };
}

function uiObject({
  id,
  assetId,
  title,
  sourceType,
  screenType,
  description,
  extractionStage,
  requiresRawificationBeforeUiExtraction,
  rawifyEligible,
  legibility,
  trustLevel,
  sourceUrl,
}) {
  const usability = classifyUiObjectUsability({ sourceType, screenType, sourceUrl });
  return {
    id,
    assetId,
    title,
    sourceType,
    screenType,
    description,
    extractionStage: extractionStage || (sourceType === 'store_art' ? 'pre_rawification' : 'ui_extracted'),
    requiresRawificationBeforeUiExtraction: Boolean(requiresRawificationBeforeUiExtraction),
    rawifyEligible,
    legibility,
    trustLevel,
    bounds: { x: 0, y: 0, width: 1, height: 1, unit: 'relative' },
    ocrText: '',
    usability,
    sourceUrl,
  };
}

function classifyUiObjectUsability({ sourceType, screenType, sourceUrl }) {
  if (sourceType === 'raw_app_proof') {
    return {
      status: 'recommended',
      label: 'Ready for ads',
      reason: 'Uploaded or captured app screen.',
      confidence: 'high',
    };
  }
  if (sourceType === 'website_asset' || screenType === 'marketing_image') {
    return {
      status: 'blocked',
      label: 'Not used',
      reason: 'This looks like a marketing or website image, not a clean app screen.',
      confidence: 'medium',
    };
  }
  if (sourceType === 'store_art') {
    return {
      status: 'review',
      label: 'Rawify first',
      reason: 'Store listing art needs rawification before UI extraction unless it is approved as already-raw app proof.',
      confidence: 'medium',
    };
  }
  const dimensions = imageDimensionsFromAnyUrl(sourceUrl);
  if (dimensions) {
    const ratio = dimensions.height / Math.max(1, dimensions.width);
    if (dimensions.width >= 600 && dimensions.height >= 1100 && ratio >= 1.45) {
      return {
        status: 'recommended',
        label: 'Looks usable',
        reason: 'High-resolution vertical app screenshot.',
        confidence: 'medium',
      };
    }
    if (dimensions.width < 420 || dimensions.height < 700) {
      return {
        status: 'blocked',
        label: 'Too small',
        reason: 'Too low-resolution to use cleanly in ads.',
        confidence: 'medium',
      };
    }
    return {
      status: 'review',
      label: 'Check it',
      reason: ratio < 1.2 ? 'Landscape or wide image; may not be a clean app screen.' : 'Could be useful, but needs a quick look.',
      confidence: 'low',
    };
  }
  return {
    status: 'blocked',
    label: 'Not used',
    reason: 'This asset is context only.',
    confidence: 'medium',
  };
}

function imageDimensionsFromAnyUrl(url) {
  const value = String(url || '');
  const apple = value.match(/\/(\d+)x(\d+)[^/]*\.(?:webp|jpg|jpeg|png)(?:\/|$)/i);
  if (apple) return { width: Number(apple[1]), height: Number(apple[2]) };
  return playImageDimensions(value);
}

async function enrichExtractionWithGemini(extraction, input = {}) {
  const config = geminiExtractionConfig(input);

  try {
    const profile = await requestGeminiProfile(extraction, config);
    const normalized = normalizeGeminiProfile(profile, extraction);
    if (!normalized.summary || !normalized.features.length) {
      throw new Error('Automated app-info extraction returned an incomplete app profile.');
    }

    const enriched = {
      ...extraction,
      app: {
        ...extraction.app,
        summary: normalized.summary,
      },
      aiProfile: {
        mode: 'automated_app_profile',
        status: 'applied',
        generatedAt: new Date().toISOString(),
        featureCount: normalized.features.length,
      },
    };

    enriched.claimCandidates = normalized.features.map((feature, index) => ({
      id: `claim-${index + 1}`,
      text: feature.text,
      source: feature.source,
      status: 'suggested',
      selected: true,
      confidence: feature.confidence,
    }));
    enriched.reviewSummary = buildReviewSummary(enriched.uiObjects, enriched.claimCandidates);

    return enriched;
  } catch (error) {
    throw new Error(`Automated app-info extraction failed: ${safeErrorMessage(error)}`);
  }
}

function geminiExtractionConfig() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!apiKey) {
    throw new Error('App-info extraction is not configured.');
  }

  return {
    apiKey,
    model: process.env.GEMINI_EXTRACTION_MODEL || GEMINI_DEFAULT_MODEL,
  };
}

async function requestGeminiProfile(extraction, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        store: false,
        input: buildGeminiProfilePrompt(extraction),
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: geminiProfileSchema(),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`App-info extraction failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const text = geminiOutputText(payload);
    if (!text) {
      throw new Error('App-info extraction returned an empty response.');
    }
    return parseGeminiJson(text);
  } finally {
    clearTimeout(timer);
  }
}

function buildGeminiProfilePrompt(extraction) {
  const evidence = {
    app: {
      name: extraction.app.name,
      platform: extraction.platform,
      category: extraction.app.category,
      subtitle: extraction.app.subtitle || '',
      seller: extraction.app.seller || '',
      price: extraction.app.price || '',
      rating: extraction.app.rating,
      ratingCount: extraction.app.ratingCount,
      storeUrl: extraction.app.storeUrl || extraction.url,
      description: shortenSentence(extraction.app.description || '', 6000),
    },
    screenshots: extraction.uiObjects.slice(0, 8).map((object, index) => ({
      id: object.id || `screen-${index + 1}`,
      label: object.title || `Store screenshot ${index + 1}`,
      sourceType: object.sourceType,
      screenType: object.screenType,
      usability: object.usability?.status || '',
      dimensions: imageDimensionsFromAnyUrl(object.sourceUrl),
      url: object.sourceUrl,
    })),
  };

  return `You are Mobile Ad Agent's first-pass app-info extractor.

Return JSON only. Keep the result simple for a review UI: one clear app summary and a short list of key features.

Rules:
- Use only the evidence in the metadata below.
- Do not invent outcomes, awards, testimonials, prices, medical claims, or platform claims.
- Do not include privacy policy, subscription, free trial, legal, or generic marketing filler as key features.
- The summary should be one plain sentence, 12 to 28 words, explaining what the app helps users do.
- Features should be 3 to 5 short user-facing points.
- If a point is mostly inferred from category or screenshot labels, use low confidence.
- If screenshots only have URLs and no visible text here, do not create new feature claims from the URLs alone.

Evidence:
${JSON.stringify(evidence, null, 2)}`;
}

function geminiProfileSchema() {
  return {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One plain sentence explaining what the app helps users do.',
      },
      features: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'A short user-facing key feature.',
            },
            source: {
              type: 'string',
              description: 'Brief source label such as Store description, Store metadata, or Screenshot labels.',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'How strongly the evidence supports this feature.',
            },
          },
          required: ['text', 'source', 'confidence'],
        },
      },
    },
    required: ['summary', 'features'],
  };
}

function geminiOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  if (typeof payload?.text === 'string') return payload.text;
  if (typeof payload?.response?.text === 'string') return payload.response.text;

  const outputParts = [];
  const appendText = (value) => {
    if (typeof value === 'string') outputParts.push(value);
  };
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    appendText(value.text);
    appendText(value.output_text);
    if (Array.isArray(value.parts)) value.parts.forEach(visit);
    if (Array.isArray(value.content)) value.content.forEach(visit);
    if (Array.isArray(value.output)) value.output.forEach(visit);
    if (Array.isArray(value.steps)) value.steps.forEach(visit);
    if (Array.isArray(value.candidates)) value.candidates.forEach(visit);
  };
  visit(payload);
  return outputParts.join('').trim();
}

function parseGeminiJson(text) {
  const raw = cleanText(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('App-info extraction returned invalid JSON.');
  }
}

function normalizeGeminiProfile(profile, extraction) {
  return {
    summary: normalizeAiSummary(profile?.summary, extraction),
    features: normalizeAiFeatures(profile?.features, extraction),
  };
}

function normalizeAiSummary(summary, extraction) {
  let text = cleanText(summary);
  if (!text) return '';
  if (/privacy policy|terms of use|subscription|free trial|cancel anytime/i.test(text)) return '';
  text = shortenSentence(text.replace(/\s+/g, ' '), 180).replace(/[.!?]+$/g, '');
  if (text.split(/\s+/).length < 6) return '';
  if (!text.toLowerCase().includes(shortAppName(extraction.app.name).toLowerCase())) {
    text = `${shortAppName(extraction.app.name)} ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  }
  return sentenceCase(text);
}

function normalizeAiFeatures(features, extraction) {
  if (!Array.isArray(features)) return [];
  const seen = new Set();
  const normalized = [];

  for (const item of features) {
    const rawText = typeof item === 'string' ? item : item?.text;
    const cleaned =
      normalizeFeatureSentence(rawText, extraction.app.name) ||
      sentenceCase(stripMarketingNoise(rawText));
    if (!cleaned || /privacy policy|terms of use|subscription|free trial|cancel anytime/i.test(cleaned)) continue;
    const key = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      text: cleaned,
      source: normalizeAiSource(item?.source, extraction),
      confidence: normalizeConfidence(item?.confidence),
    });
    if (normalized.length >= 5) break;
  }

  return normalized;
}

function normalizeAiSource(source, extraction) {
  const text = cleanText(source);
  if (/screen|image|visual/i.test(text)) return 'Store screenshots';
  if (/metadata|category|rating|price/i.test(text)) return 'Store metadata';
  if (/subtitle/i.test(text)) return 'Store subtitle';
  if (/description|listing/i.test(text)) return `${sourceLabelForPlatform(extraction.platform)} description`;
  return text ? shortenSentence(text, 60).replace(/[.!?]+$/g, '') : `${sourceLabelForPlatform(extraction.platform)} description`;
}

function sourceLabelForPlatform(platform) {
  if (platform === 'app_store') return 'App Store';
  if (platform === 'play_store') return 'Google Play';
  return 'Website';
}

function normalizeConfidence(confidence) {
  const value = cleanText(confidence).toLowerCase();
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function safeErrorMessage(error) {
  if (error?.name === 'AbortError') return 'app-info extraction timed out.';
  return cleanText(error?.message || 'app-info extraction was unavailable.').slice(0, 160);
}

function normalizeFeatureSentence(sentence, appName) {
  let text = stripMarketingNoise(sentence);
  if (!text) return '';
  if (/privacy policy|terms of use|subscription|copyright|free trial|cancel anytime/i.test(text)) return '';
  if (/apple editor|award winner|featured by|as seen in/i.test(text)) return '';
  if (/transform your fitness journey|ultimate ai personal trainer|premier fitness tracker/i.test(text)) return '';
  if (/ultimate|you won't just|on your terms|just for you/i.test(text) && text.length < 90) return '';

  text = text
    .replace(new RegExp(`^${escapeRegExp(shortAppName(appName))}\\s+(is|helps|lets|allows)\\s+`, 'i'), '')
    .replace(/^users can\s+/i, '')
    .replace(/^you can\s+/i, '')
    .replace(/^the app\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.split(/\s+/).length < 4) return '';
  return sentenceCase(text);
}

function stripMarketingNoise(sentence) {
  return cleanText(sentence)
    .replace(/\*/g, '')
    .replace(/^apple editor.?s choice award winner\s*/i, '')
    .replace(/^award winner\s*/i, '')
    .replace(/^featured\s+[^.]+?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortAppName(appName) {
  return cleanText(appName).split(':')[0].trim() || 'This app';
}

function sentenceCase(text) {
  const raw = cleanText(text);
  const isTruncated = raw.endsWith('...');
  const cleaned = raw.replace(isTruncated ? /\.+$/g : /[.!?]+$/g, '');
  if (!cleaned) return '';
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}${isTruncated ? '...' : '.'}`;
}

function shortenSentence(text, limit) {
  const cleaned = cleanText(text).replace(/[.!?]+$/g, '');
  if (cleaned.length <= limit) return cleaned;
  const sliced = cleaned.slice(0, limit - 3).trim();
  const boundary = sliced.lastIndexOf(' ');
  const shortened = boundary > Math.floor(limit * 0.6) ? sliced.slice(0, boundary) : sliced;
  return `${shortened.replace(/[,;:\s]+$/g, '')}...`;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferScreenType(description, index) {
  const text = description.toLowerCase();
  if (/map|nearby|location|distance/.test(text) && index < 2) return 'map_or_location';
  if (/track|progress|history|streak|log/.test(text)) return 'tracking_or_progress';
  if (/edit|photo|video|create|design/.test(text)) return 'creation_or_editor';
  if (/learn|lesson|course|practice/.test(text)) return 'learning';
  if (/budget|spend|money|finance/.test(text)) return 'finance';
  return index === 0 ? 'hero_or_home' : 'feature_screen';
}

async function fetchJson(url) {
  const text = await fetchText(url, { accept: 'application/json' });
  return JSON.parse(text);
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) {
      throw new Error(`Fetch failed with HTTP ${response.status}.`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractHtmlMeta(html) {
  const title = decodeHtml(matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const metas = {};
  const metaRegex = /<meta\s+([^>]+)>/gi;
  let match;
  while ((match = metaRegex.exec(html))) {
    const attrs = parseAttributes(match[1]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content) metas[key] = decodeHtml(attrs.content);
  }
  return {
    title: cleanText(metas['og:title'] || metas['twitter:title'] || title),
    description: cleanText(metas.description || metas['og:description'] || metas['twitter:description'] || ''),
    image: absolutishUrl(metas['og:image'] || metas['twitter:image'] || ''),
    siteName: cleanText(metas['og:site_name'] || ''),
    category: cleanText(metas['application-category'] || ''),
  };
}

function matchFirst(value, regex) {
  const match = String(value || '').match(regex);
  return match?.[1] || '';
}

function extractPlayImageUrls(html) {
  const bestBySource = new Map();
  for (const url of extractUrls(html, /https:\/\/play-lh\.googleusercontent\.com\/[^"'\\\s<>)]+/g)) {
    const cleaned = url.replace(/\\u003d/g, '=');
    const dimensions = playImageDimensions(cleaned);
    if (!dimensions || !isScreenshotShaped(dimensions)) {
      continue;
    }
    const sourceKey = cleaned.split('=')[0];
    const score = dimensions.width * dimensions.height + (dimensions.height > dimensions.width ? 50000 : 0);
    const existing = bestBySource.get(sourceKey);
    if (!existing || score > existing.score) {
      bestBySource.set(sourceKey, { url: cleaned, score });
    }
  }
  return [...bestBySource.values()]
    .sort((left, right) => right.score - left.score)
    .map((item) => item.url)
    .slice(0, 10);
}

function extractMzstaticArtworkUrls(html) {
  return extractUrls(html, /https:\/\/[^"'\\\s<>;)]+mzstatic\.com[^"'\\\s<>;)]+/g)
    .map((url) => decodeHtml(url).replace(/\\\//g, '/').replace(/[),;]+$/g, ''));
}

function extractUrls(html, regex) {
  return [...String(html || '').matchAll(regex)].map((match) => match[0]);
}

function imageUrlArea(url) {
  const match = String(url).match(/\/(\d+)x(\d+)[^/]*\.(webp|jpg|png)$/i);
  return match ? Number(match[1]) * Number(match[2]) : 0;
}

function playImageDimensions(url) {
  const match = String(url).match(/=w(\d+)-h(\d+)(?:-|$)/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function isScreenshotShaped({ width, height }) {
  const area = width * height;
  if (area < 120000) return false;
  const ratio = Math.max(width, height) / Math.min(width, height);
  return ratio >= 1.35 && ratio <= 2.4;
}

function parseAttributes(raw) {
  const attrs = {};
  const attrRegex = /([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = attrRegex.exec(raw))) {
    attrs[match[1].toLowerCase()] = match[3] || match[4] || match[5] || '';
  }
  return attrs;
}

function findAppleId(url) {
  const pathMatch = url.pathname.match(/\/id(\d+)/);
  if (pathMatch) return pathMatch[1];
  const queryId = url.searchParams.get('id');
  return queryId && /^\d+$/.test(queryId) ? queryId : null;
}

function countryFromAppleUrl(url) {
  const first = url.pathname.split('/').filter(Boolean)[0];
  return first && /^[a-z]{2}$/i.test(first) ? first.toLowerCase() : null;
}

function stripGooglePlaySuffix(value) {
  return cleanText(value.replace(/\s*[\-–—]\s*Apps on Google Play\s*$/i, ''));
}

function hostnameName(url) {
  return titleCase(url.hostname.replace(/^www\./, '').split('.')[0].replace(/[-_]/g, ' '));
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function titleCase(value) {
  return cleanText(value).replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function absolutishUrl(value) {
  return cleanText(value).replace(/\\\//g, '/');
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
