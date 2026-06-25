import {
  buildQaReport,
  createPortfolioState,
  exportManifest,
  generateDraftPack,
} from '../lib/local-pipeline.mjs';

const portfolio = createPortfolioState();
const app = portfolio.apps[0];
const pack = generateDraftPack({
  appId: app.id,
  appOverride: app,
  config: {
    outputs: { imageAds: true, ugcVideos: true },
    imageSetup: {
      layouts: ['product_proof', 'lifestyle'],
      formats: ['1:1', '4:5', '9:16'],
      perClaim: 1,
    },
    ugcSetup: {
      style: 'natural',
      durationSeconds: 15,
      count: 2,
    },
  },
});

pack.drafts = pack.drafts.map((draft) => ({ ...draft, status: 'approved' }));
const qa = buildQaReport(pack, app);
const manifest = exportManifest({
  appId: app.id,
  pack,
  qa,
  destination: 'download_zip',
});

const failures = [];

if (!portfolio.apps.length) {
  failures.push('portfolio should include sample apps');
}
if (pack.providerMutations !== 0) {
  failures.push('draft pack providerMutations must be 0');
}
if (manifest.providerMutations !== 0) {
  failures.push('manifest providerMutations must be 0');
}
if (!pack.summary.imageCount || !pack.summary.ugcCount) {
  failures.push('pack should include both image ads and UGC videos');
}
if (!qa.checks.every((check) => ['pass', 'warn'].includes(check.status))) {
  failures.push('approved local pack should not have QA hold checks');
}
if (manifest.handoff.destination !== 'download_zip') {
  failures.push('manifest handoff destination should be preserved');
}

if (failures.length) {
  console.error('Local app smoke failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Local app smoke passed');
console.log(JSON.stringify({
  app: app.name,
  drafts: pack.summary.total,
  imageAds: manifest.outputs.imageAds,
  ugcVideos: manifest.outputs.ugcVideos,
  qaVerdict: qa.verdict,
  providerMutations: manifest.providerMutations,
}, null, 2));
