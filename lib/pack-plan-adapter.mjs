/* Bounded public-market research adapter for pre-generation Pack Plans.
   The adapter may use live web search, but it never authorizes product claims:
   every returned market signal is explicitly `canSupportProductClaim: false`.

   Missing configuration or failed research is a truthful limited state. It is
   never replaced with invented review counts, quotations, or source URLs. */

const DEFAULT_MODEL = 'gemini-3.5-flash';
const configuredResearchTimeout = Number(process.env.GEMINI_PACK_PLAN_TIMEOUT_MS || 12_000);
const RESEARCH_TIMEOUT_MS = Number.isFinite(configuredResearchTimeout)
  ? Math.min(28_000, Math.max(3_000, configuredResearchTimeout))
  : 12_000;
const MAX_SIGNALS = 8;
const MAX_SOURCES = 20;

export async function researchMarketSignals({
  app,
  priorLearnings = [],
  apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  model = process.env.GEMINI_PACK_PLAN_MODEL || DEFAULT_MODEL,
  fetchImpl = fetch,
  now = () => Date.now(),
  locale = 'en-US',
} = {}) {
  const capturedAt = new Date(now()).toISOString();
  if (!app?.name) return limitedResearch({ capturedAt, locale, reason: 'App information is missing.' });
  if (!apiKey) return limitedResearch({ capturedAt, locale, reason: 'Public market research is not configured.' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        store: false,
        tools: [{ type: 'google_search' }],
        input: buildResearchPrompt({ app, priorLearnings, locale }),
      }),
    });
    if (!response.ok) throw new Error(`Public research returned HTTP ${response.status}.`);
    const payload = await response.json();
    return normalizeGroundedResearch(payload, { app, capturedAt, locale });
  } catch (error) {
    return limitedResearch({
      capturedAt,
      locale,
      reason: error?.name === 'AbortError'
        ? 'Public market research timed out.'
        : safeMessage(error?.message || 'Public market research was unavailable.'),
    });
  } finally {
    clearTimeout(timer);
  }
}

export function limitedResearch({ capturedAt = new Date().toISOString(), locale = 'en-US', reason = 'Limited public signal.' } = {}) {
  return {
    schemaVersion: 'market-research.v1',
    status: 'limited',
    coverage: 'exploratory',
    locale,
    audience: { segment: '', triggerMoment: '' },
    marketOpening: '',
    sources: [],
    marketSignals: [],
    sourceCounts: { publicSources: 0, appReviewSources: 0, communitySources: 0, competitorSources: 0, officialSources: 0 },
    queries: [],
    limitations: [safeMessage(reason)],
    researchIntelligenceCalls: 0,
    searchQueryCount: 0,
    capturedAt,
    providerMutations: 0,
  };
}

export function normalizeGroundedResearch(payload, { app, capturedAt = new Date().toISOString(), locale = 'en-US' } = {}) {
  const blocks = modelTextBlocks(payload);
  const outputText = blocks.map((block) => block.text).join('\n').trim();
  const parsed = parseJsonOutput(outputText);
  const citationRows = blocks.flatMap((block) => (block.annotations || []).map((annotation) => ({
    ...annotation,
    text: block.text,
  })));
  const sources = uniqueSources(citationRows).slice(0, MAX_SOURCES);
  const sourceByUrl = new Map(sources.map((source) => [canonicalUrl(source.url), source]));
  const signals = [];

  for (const raw of Array.isArray(parsed?.signals) ? parsed.signals : []) {
    if (signals.length >= MAX_SIGNALS) break;
    const text = cleanText(raw?.text || raw?.theme).slice(0, 260);
    if (!text) continue;
    const citedUrls = new Set(
      (Array.isArray(raw?.sourceUrls) ? raw.sourceUrls : [])
        .map(canonicalUrl)
        .filter((url) => sourceByUrl.has(url))
    );
    for (const row of citationRows) {
      if (annotationSupportsText(row, outputText, text)) citedUrls.add(canonicalUrl(row.url));
    }
    const sourceIds = [...citedUrls].map((url) => sourceByUrl.get(url)?.id).filter(Boolean);
    if (!sourceIds.length) continue;
    signals.push({
      id: `market-signal-${signals.length + 1}`,
      kind: normalizeSignalKind(raw?.kind),
      text,
      sourceIds,
      sourceFamilies: [...new Set(sourceIds.map((id) => sources.find((source) => source.id === id)?.family).filter(Boolean))],
      canSupportProductClaim: false,
      providerMutations: 0,
    });
  }

  const usedSourceIds = new Set(signals.flatMap((signal) => signal.sourceIds));
  const usedSources = sources.filter((source) => usedSourceIds.has(source.id));
  const sourceCounts = countSourceFamilies(usedSources);
  const familyCount = new Set(usedSources.map((source) => source.family)).size;
  const coverage = signals.length && familyCount >= 2
    ? 'grounded'
    : signals.length
      ? 'directional'
      : 'exploratory';
  const queries = searchQueries(payload).slice(0, 6);

  return {
    schemaVersion: 'market-research.v1',
    status: signals.length ? 'complete' : 'limited',
    coverage,
    locale,
    audience: {
      segment: cleanText(parsed?.audience?.segment).slice(0, 140),
      triggerMoment: cleanText(parsed?.audience?.triggerMoment).slice(0, 180),
    },
    marketOpening: cleanText(parsed?.marketOpening).slice(0, 240),
    sources: usedSources,
    marketSignals: signals,
    sourceCounts,
    queries,
    limitations: signals.length ? [] : ['No sufficiently cited public market pattern was found.'],
    researchIntelligenceCalls: 1,
    searchQueryCount: queries.length,
    appIdentity: {
      name: cleanText(app?.name),
      storeUrl: safePublicUrl(app?.extraction?.app?.storeUrl || app?.extraction?.url || ''),
    },
    capturedAt,
    providerMutations: 0,
  };
}

function buildResearchPrompt({ app, priorLearnings, locale }) {
  const claims = (app.claims || [])
    .filter((claim) => claim && claim.selected !== false && !claim.ignored && claim.supported !== false)
    .slice(0, 8)
    .map((claim) => claim.text);
  const learningNotes = priorLearnings
    .slice(0, 12)
    .map((event) => cleanText(event?.instruction || event?.observation || event?.text || event?.reason || ''))
    .filter(Boolean);
  const identity = {
    name: app.name,
    category: app.extraction?.app?.category || app.source || '',
    storeUrl: app.extraction?.app?.storeUrl || app.extraction?.url || '',
    officialSummary: app.tagline || '',
    verifiedFeatures: claims,
    priorLearningNotes: learningNotes,
    locale,
  };

  return `You are researching one mobile app to choose a falsifiable paid-creative angle. Search current public web sources.

Research jobs:
1. Find how real users describe the problem, trigger moment, desired outcome, objection, switching reason, or alternative around this app and its category.
2. Focus on relevant public community discussions, official context, and up to three close competitor listing/review pages. The app's own written store reviews are ingested separately.
3. Distinguish post-use app-review value from pre-purchase community tension.

Return JSON only in this shape:
{
  "audience": { "segment": "plain non-demographic audience", "triggerMoment": "specific situation" },
  "marketOpening": "short derived inference, not a fact",
  "signals": [
    { "kind": "audience_tension|desired_outcome|trigger_moment|objection|switching_reason|language_pattern|alternative_used", "text": "short paraphrase", "sourceUrls": ["exact cited URL"] }
  ]
}

Hard rules:
- Return at most ${MAX_SIGNALS} signals.
- Every signal must be a paraphrase supported by one or more public citations in the response.
- Do not invent review counts, percentages, quotations, demographics, app capabilities, performance, market size, or whitespace.
- Public comments and competitor pages are market signals only; they never prove what this app can do.
- Do not copy competitor hooks or review wording verbatim.
- If useful evidence is sparse or ambiguous, return fewer signals or an empty signals array.
- Use the selected locale only; do not silently merge markets or languages.

Verified app context (for identity and search targeting, not as market evidence):
${JSON.stringify(identity, null, 2)}`;
}

function modelTextBlocks(payload) {
  const blocks = [];
  for (const step of payload?.steps || []) {
    if (step?.type !== 'model_output') continue;
    for (const content of step.content || []) {
      if (content?.type !== 'text' || typeof content.text !== 'string') continue;
      blocks.push({ text: content.text, annotations: content.annotations || [] });
    }
  }
  if (!blocks.length && typeof payload?.output_text === 'string') {
    blocks.push({ text: payload.output_text, annotations: payload.annotations || [] });
  }
  return blocks;
}

function uniqueSources(annotationRows) {
  const sources = new Map();
  for (const annotation of annotationRows) {
    if (annotation?.type !== 'url_citation') continue;
    const url = safePublicUrl(annotation.url);
    const key = canonicalUrl(url);
    if (!key || sources.has(key)) continue;
    sources.set(key, {
      id: `public-source-${sources.size + 1}`,
      url,
      title: cleanText(annotation.title || hostname(url)).slice(0, 120),
      family: sourceFamily(url),
      capturedAt: new Date().toISOString(),
      providerMutations: 0,
    });
  }
  return [...sources.values()];
}

function annotationSupportsText(annotation, outputText, signalText) {
  const start = Number(annotation.start_index ?? annotation.startIndex);
  const end = Number(annotation.end_index ?? annotation.endIndex);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const cited = cleanText(outputText.slice(Math.max(0, start), Math.max(start, end))).toLowerCase();
  const signal = cleanText(signalText).toLowerCase();
  if (!cited || !signal) return false;
  return cited.includes(signal) || signal.includes(cited) || sharedTerms(cited, signal) >= 4;
}

function sharedTerms(left, right) {
  const leftTerms = new Set(left.split(/\W+/).filter((word) => word.length >= 4));
  return new Set(right.split(/\W+/).filter((word) => leftTerms.has(word))).size;
}

function searchQueries(payload) {
  const queries = [];
  for (const step of payload?.steps || []) {
    if (step?.type !== 'google_search_call') continue;
    for (const query of step?.arguments?.queries || []) {
      const cleaned = cleanText(query);
      if (cleaned && !queries.includes(cleaned)) queries.push(cleaned);
    }
  }
  return queries;
}

function countSourceFamilies(sources) {
  const counts = { publicSources: sources.length, appReviewSources: 0, communitySources: 0, competitorSources: 0, officialSources: 0 };
  for (const source of sources) {
    if (source.family === 'app_reviews') counts.appReviewSources += 1;
    if (source.family === 'community') counts.communitySources += 1;
    if (source.family === 'competitor') counts.competitorSources += 1;
    if (source.family === 'official') counts.officialSources += 1;
  }
  return counts;
}

function sourceFamily(url) {
  const host = hostname(url);
  if (/apps\.apple\.com|play\.google\.com/.test(host)) return 'app_reviews';
  if (/reddit\.com|quora\.com|stackexchange\.com|forum|community/.test(host)) return 'community';
  if (/support\.|help\.|docs\.|developer\./.test(host)) return 'official';
  return 'competitor';
}

function normalizeSignalKind(value) {
  const allowed = new Set(['audience_tension', 'desired_outcome', 'trigger_moment', 'objection', 'switching_reason', 'language_pattern', 'alternative_used']);
  const cleaned = cleanText(value).toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
  return allowed.has(cleaned) ? cleaned : 'language_pattern';
}

function parseJsonOutput(text) {
  const cleaned = cleanText(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try { return JSON.parse(match[0]); } catch { return {}; }
  }
}

function safePublicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function canonicalUrl(value) {
  const safe = safePublicUrl(value);
  if (!safe) return '';
  const url = new URL(safe);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|gclid|fbclid)/i.test(key)) url.searchParams.delete(key);
  }
  return url.href.replace(/\/$/, '');
}

function hostname(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function safeMessage(value) {
  return cleanText(value).replace(/gemini|google generative language|model/ig, 'research service').slice(0, 180);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
