/* Direct universal Script Agent tests. No network or media providers. */

import assert from 'node:assert/strict';
import {
  buildScriptPlanningRequest,
  runScriptAgent,
  validateScriptPlanForRequest,
} from '../lib/script-agent.mjs';

const fixtures = [
  {
    source: {
      appId: 'app-zorbly', appName: 'Zorbly: Label Scanner', appCategory: 'Unexpected Utility',
      appSummary: 'Scan a product label and get the useful details in one readable result.',
      claims: [{ id: 'claim-scan', text: 'Scan product labels and review the extracted details.' }],
      screens: [{ id: 'screen-result', label: 'Readable label result', detail: 'Extracted label details shown in a clear list.' }],
      angles: [], audienceNotes: ['People who struggle to read small product labels.'], styleNotes: ['Plain language.'],
    },
    hook: 'You scan the label, then still search for the answer.',
    tension: 'I kept zooming every line and still missed the detail I actually needed.',
    bridge: 'Then I put the same label through one clearer view.',
    payload: 'It pulls the extracted label details into one readable result.',
    proof: 'This result screen shows those label details in a clear list.',
    reinforcement: 'Now I can find the useful part without another search.',
    reaction: 'It is called Zorbly. I would scan the annoying label first.',
  },
  {
    source: {
      appId: 'app-moonmoss', appName: 'MoonMoss', appCategory: 'Bioluminescent Home Rituals',
      appSummary: 'Use short sound recordings to compare how a houseplant changes across daily check-ins.',
      claims: [{ id: 'claim-compare', text: 'Compare short plant sound recordings across daily check-ins.' }],
      screens: [{ id: 'screen-compare', label: 'Recording comparison', detail: 'Two dated plant sound recordings shown side by side.' }],
      angles: [], audienceNotes: ['Plant owners curious about small changes over time.'], styleNotes: ['Curious and grounded.'],
    },
    hook: 'Your plant sounds different today, but would you actually notice?',
    tension: 'I could hear a change and still could not remember yesterday clearly.',
    bridge: 'So I started comparing the same short check-in instead of guessing.',
    payload: 'It keeps those plant sound recordings together across daily check-ins.',
    proof: 'This comparison screen shows two dated recordings side by side.',
    reinforcement: 'That makes the small change much easier for me to notice.',
    reaction: 'It is called MoonMoss. I would record the plant you check most.',
  },
];

for (const [index, fixture] of fixtures.entries()) {
  const assignmentId = 'ugc-1';
  const hookPlan = {
    status: 'selected',
    planFingerprint: `hook-plan-${index + 1}`,
    selectedHooks: [{
      assignmentId,
      candidateId: `hook-${index + 1}`,
      spokenHook: fixture.hook,
      caption: 'what did I miss?',
      evidenceRefs: ['app_summary'],
      critic: { supportedEvidenceRefs: ['app_summary'], claimSafety: 5 },
    }],
  };
  const request = buildScriptPlanningRequest({
    source: fixture.source,
    hookPlan,
    unitBindings: [{ assignmentId, unitId: `unit-${index + 1}`, claimId: fixture.source.claims[0].id, proofIds: [fixture.source.screens[0].id] }],
  });
  const calls = [];
  const plan = await runScriptAgent({
    source: fixture.source,
    hookPlan,
    request,
    generateJson: async ({ stage, prompt }) => {
      calls.push({ stage, prompt });
      if (stage === 'script_writer') return { scripts: [writerScript(fixture, assignmentId)] };
      if (stage === 'script_evidence_verifier') return { verifications: [passingVerification(assignmentId, fixture)] };
      if (stage === 'script_critic') return { reviews: [passingReview(assignmentId, fixture)] };
      throw new Error(`Unexpected stage ${stage}`);
    },
  });
  validateScriptPlanForRequest({ plan, request, allowHeld: false });
  assert.equal(plan.status, 'selected');
  assert.equal(plan.scripts.length, 1);
  assert.equal(plan.scripts[0].beats.hook, fixture.hook);
  assert.equal(plan.scripts[0].beats.reaction, fixture.reaction);
  assert.equal(plan.intelligenceUsage.intelligenceCallCount, 3);
  assert.deepEqual(plan.intelligenceUsage.stageCalls, { script_writer: 1, script_evidence_verifier: 1, script_critic: 1 });
  assert.match(calls[0].prompt, /There are no category templates/i);
  assert.match(calls[0].prompt, /recording phone is the camera and must stay outside the image/i);
  assert.match(calls[1].prompt, /strict line-by-line evidence verifier/i);
  assert.match(calls[2].prompt, /independent UGC Script Critic/i);
  assert.ok(!calls.some((call) => /if category|category map|duolingo|gymlevels|fitbod|language streak/i.test(call.prompt)));
}

/* A visible second phone in the creator prompt must hold before verifier,
   critic, or media generation can run. */
{
  const fixture = fixtures[0];
  const assignmentId = 'ugc-1';
  const hookPlan = {
    status: 'selected', planFingerprint: 'visible-device-hook-plan',
    selectedHooks: [{ assignmentId, candidateId: 'visible-device-hook', spokenHook: fixture.hook, caption: 'what did I miss?', evidenceRefs: ['app_summary'], critic: { supportedEvidenceRefs: ['app_summary'] } }],
  };
  const request = buildScriptPlanningRequest({ source: fixture.source, hookPlan, unitBindings: [{ assignmentId, unitId: 'visible-device-unit', claimId: 'claim-scan', proofIds: ['screen-result'] }] });
  const stages = [];
  const held = await runScriptAgent({
    source: fixture.source,
    hookPlan,
    request,
    generateJson: async ({ stage }) => {
      stages.push(stage);
      const script = writerScript(fixture, assignmentId);
      script.creatorPlan.firstFramePrompt = 'Selfie frame of the creator holding a phone beside their face.';
      script.creatorPlan.negativePrompt = 'text, logos, studio light';
      return { scripts: [script] };
    },
  });
  assert.equal(held.status, 'held');
  assert.equal(held.scripts.length, 0);
  assert.deepEqual(stages, ['script_writer', 'script_writer', 'script_writer', 'script_writer']);
  assert.ok(held.holdReasons.some((reason) => /phone\/device inside|devices out of frame/i.test(reason)));
}

/* Unsupported specificity must hold without any media stage existing. */
{
  const fixture = fixtures[0];
  const assignmentId = 'ugc-1';
  const hookPlan = {
    status: 'selected', planFingerprint: 'unsafe-hook-plan',
    selectedHooks: [{ assignmentId, candidateId: 'unsafe-hook', spokenHook: fixture.hook, caption: 'what did I miss?', evidenceRefs: ['app_summary'], critic: { supportedEvidenceRefs: ['app_summary'] } }],
  };
  const request = buildScriptPlanningRequest({ source: fixture.source, hookPlan, unitBindings: [{ assignmentId, unitId: 'unsafe-unit', claimId: 'claim-scan', proofIds: ['screen-result'] }] });
  const held = await runScriptAgent({
    source: fixture.source,
    hookPlan,
    request,
    generateJson: async ({ stage }) => {
      if (stage === 'script_writer') {
        const script = writerScript(fixture, assignmentId);
        script.beats.payload = 'It found every dangerous ingredient perfectly for three years.';
        return { scripts: [script] };
      }
      if (stage === 'script_evidence_verifier') {
        const verification = passingVerification(assignmentId, fixture);
        verification.verdict = 'hold';
        verification.beatSupport.find((beat) => beat.beatId === 'payload').supported = false;
        verification.beatSupport.find((beat) => beat.beatId === 'payload').unsupportedSpans = ['every dangerous ingredient perfectly', 'for three years'];
        verification.reason = 'The result and tenure are unsupported.';
        return { verifications: [verification] };
      }
      return {
        reviews: [{
          ...passingReview(assignmentId, fixture), verdict: 'hold', claimSafety: 1,
          unsupportedSpans: ['every dangerous ingredient perfectly', 'for three years'],
          reason: 'The result and tenure are unsupported.',
        }],
      };
    },
  });
  assert.equal(held.status, 'held');
  assert.equal(held.scripts.length, 0);
}

/* A hard-sales app-download CTA must be rejected before verifier/critic or
   media calls, even if an intelligence critic would otherwise approve it. */
{
  const fixture = fixtures[0];
  const assignmentId = 'ugc-1';
  const hookPlan = {
    status: 'selected', planFingerprint: 'hard-cta-hook-plan',
    selectedHooks: [{ assignmentId, candidateId: 'hard-cta-hook', spokenHook: fixture.hook, caption: 'what did I miss?', evidenceRefs: ['app_summary'], critic: { supportedEvidenceRefs: ['app_summary'] } }],
  };
  const request = buildScriptPlanningRequest({ source: fixture.source, hookPlan, unitBindings: [{ assignmentId, unitId: 'hard-cta-unit', claimId: 'claim-scan', proofIds: ['screen-result'] }] });
  const stages = [];
  const held = await runScriptAgent({
    source: fixture.source,
    hookPlan,
    request,
    generateJson: async ({ stage }) => {
      stages.push(stage);
      const script = writerScript(fixture, assignmentId);
      script.beats.reaction = 'Go download Zorbly right now.';
      return { scripts: [script] };
    },
  });
  assert.equal(held.status, 'held');
  assert.deepEqual(stages, ['script_writer', 'script_writer', 'script_writer', 'script_writer']);
  assert.ok(held.holdReasons.some((reason) => /hard-sales CTA/i.test(reason)));
}

console.log('Script Agent tests passed');
console.log(JSON.stringify({ fixtures: fixtures.length, productionCategoryBranches: 0, providerMutations: 0 }, null, 2));

function writerScript(fixture, assignmentId) {
  const claimId = fixture.source.claims[0].id;
  const proofId = fixture.source.screens[0].id;
  return {
    assignmentId,
    beats: {
      hook: fixture.hook, tension: fixture.tension, bridge: fixture.bridge, payload: fixture.payload,
      proof_voice: fixture.proof, reinforcement: fixture.reinforcement, reaction: fixture.reaction,
    },
    evidenceRefsByBeat: {
      tension: ['app_summary'], bridge: ['app_summary'], payload: [claimId], proof_voice: [proofId],
      reinforcement: [claimId], reaction: ['app_summary'],
    },
    creatorPlan: {
      setting: 'ordinary room near the object being discussed', framing: 'handheld front-camera selfie at arm length',
      persona: 'plausible everyday user from the reviewed audience', wardrobe: 'plain unbranded everyday clothing',
      emotionalArc: 'confusion to useful clarity', startingEmotion: 'mildly frustrated and curious', endingEmotion: 'relieved but conversational',
      firstFramePrompt: 'Paused front-camera phone-video frame, ordinary flat light, imperfect crop, natural skin texture, scene mostly in focus, no factual screen content. The recording phone is the camera and remains out of frame; no second phone or visible device.',
      negativePrompt: 'visible phone, visible device, second phone, studio portrait, beauty lighting, shallow bokeh, polished commercial, text, logos, extra people',
      continuityAnchors: ['same person', 'same clothing', 'same room', 'same camera distance'],
    },
  };
}

function passingReview(assignmentId, fixture) {
  return {
    assignmentId, verdict: 'pass', hookContinuity: 5, topicCoherence: 5, evidenceAlignment: 5,
    proofAlignment: 5, nativeVoice: 5, arcStrength: 5, claimSafety: 5,
    supportedEvidenceRefs: ['app_summary', fixture.source.claims[0].id, fixture.source.screens[0].id],
    unsupportedSpans: [], reason: 'The script stays coherent, native, and fully bound to reviewed evidence.',
  };
}

function passingVerification(assignmentId, fixture) {
  const claimId = fixture.source.claims[0].id;
  const proofId = fixture.source.screens[0].id;
  return {
    assignmentId, verdict: 'pass', reason: 'Every beat is directly supported or connective.',
    beatSupport: ['tension', 'bridge', 'payload', 'proof_voice', 'reinforcement', 'reaction'].map((beatId) => ({
      beatId, supported: true,
      evidenceRefs: beatId === 'proof_voice' ? [proofId] : beatId === 'payload' || beatId === 'reinforcement' ? [claimId] : ['app_summary'],
      unsupportedSpans: [], reason: 'Supported.',
    })),
  };
}
