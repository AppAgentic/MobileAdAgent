/* Proof-backed local demo input.
 *
 * These screens are reviewed rawified Duolingo assets from the July 9
 * preservation canary. The fixture exists so the local product can exercise
 * app-info review and Pack Plan creation without depending on App Store
 * availability or silently substituting fake UI.
 */

export const DEMO_APP_URL = 'https://apps.apple.com/us/app/duolingo-language-lessons/id570060128';

export function createDemoAppExtraction({ createdAt = new Date().toISOString() } = {}) {
  const proofs = [
    {
      id: 'demo-duolingo-vocabulary-choice',
      title: 'Vocabulary choice exercise',
      description: 'A Spanish vocabulary question asks the learner to choose the correct translation for the glass.',
      sourceUrl: '/demo-assets/duolingo-vocabulary-choice.jpg',
      screenType: 'vocabulary_exercise',
    },
    {
      id: 'demo-duolingo-sentence-translation',
      title: 'Sentence translation exercise',
      description: 'A guided Spanish translation exercise asks the learner to assemble a short sentence.',
      sourceUrl: '/demo-assets/duolingo-sentence-translation.jpg',
      screenType: 'translation_exercise',
    },
    {
      id: 'demo-duolingo-listening-exercise',
      title: 'Listening exercise',
      description: 'A listening exercise asks the learner to type the Spanish phrase they hear.',
      sourceUrl: '/demo-assets/duolingo-listening-exercise.jpg',
      screenType: 'listening_exercise',
    },
  ];

  return {
    schemaVersion: 'local-app-extraction.v1',
    jobId: 'extract-demo-duolingo-reviewed',
    source: 'proof_backed_local_demo',
    url: DEMO_APP_URL,
    createdAt,
    providerMutations: 0,
    platform: 'app_store',
    app: {
      name: 'Duolingo: Language Lessons',
      category: 'Education',
      subtitle: 'Short guided language practice',
      iconUrl: null,
      storeUrl: DEMO_APP_URL,
      summary: 'Duolingo helps people practice a new language through short vocabulary, translation, listening, speaking, reading, and writing exercises.',
      description: 'Practice a new language with short guided vocabulary, translation, listening, speaking, reading, and writing exercises.',
    },
    aiProfile: {
      mode: 'reviewed_demo_profile',
      status: 'applied',
      featureCount: 2,
      providerMutations: 0,
    },
    uiObjects: proofs.map((proof) => ({
      ...proof,
      sourceType: 'raw_app_proof',
      extractionStage: 'ui_extracted',
      requiresRawificationBeforeUiExtraction: false,
      rawifyEligible: false,
      trustLevel: 'reviewed',
      usability: {
        status: 'recommended',
        label: 'Ready for ads',
        reason: 'Reviewed app screen from the preservation canary.',
      },
    })),
    claimCandidates: [
      {
        id: 'demo-duolingo-language-exercise-formats',
        text: 'Practice a new language with vocabulary, translation, and listening exercises.',
        source: 'Reviewed App Store description and approved app screens',
        status: 'approved',
        selected: true,
        confidence: 'high',
      },
      {
        id: 'demo-duolingo-guided-language-practice',
        text: 'Build language skills with short guided exercises.',
        source: 'Reviewed App Store description and approved app screens',
        status: 'approved',
        selected: true,
        confidence: 'high',
      },
    ],
    reviewSummary: {
      screenCount: proofs.length,
      claimCount: 2,
      rawifyCandidateCount: 0,
      holds: [],
    },
    styleNotes: [
      'Organic creator voice',
      'Show only approved app screens',
      'Keep claims within the reviewed language-practice evidence',
    ],
  };
}
