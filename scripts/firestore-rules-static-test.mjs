import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const rules = readFileSync(join(repoRoot, 'firestore.rules'), 'utf8');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function contains(pattern) {
  return pattern.test(rules);
}

check(contains(/function\s+isOrgMember\(orgId\)[\s\S]*exists\(memberPath\(orgId\)\)/), 'rules must require org membership via members/{uid}');
check(contains(/function\s+hasOrgRole\(orgId,\s*roles\)/), 'rules must keep explicit role helper');
check(contains(/match\s+\/users\/\{uid\}[\s\S]*allow create: if isSelf\(uid\) && userCreateShape\(uid\)/), 'users can only create their own validated profile');
check(contains(/match\s+\/users\/\{uid\}[\s\S]*allow update: if isSelf\(uid\) && userUpdateShape\(uid\)/), 'users can only update mutable self-profile fields');

for (const collection of ['previewCache', 'previewSessions', 'renderTasks']) {
  check(
    contains(new RegExp(`match\\s+/${collection}/\\{[^}]+\\}[\\s\\S]*allow read, write: if false;`)),
    `${collection} must be denied to clients`
  );
}

for (const collection of ['claims', 'apiKeys', 'auditEvents']) {
  check(
    contains(new RegExp(`match\\s+/${collection}/\\{[^}]+\\}[\\s\\S]*allow read, write: if false;`)),
    `org ${collection} must be denied to clients`
  );
}

for (const collection of ['apps', 'appProfiles', 'sourceAssets', 'researchSnapshots', 'packPlans', 'creativePacks', 'generatedCreatives', 'reviewDecisions', 'learningEvents']) {
  check(
    contains(new RegExp(`match\\s+/${collection}/\\{[^}]+\\}[\\s\\S]*allow create, update, delete: if false;`)),
    `${collection} must be server-written only`
  );
}

check(contains(/match\s+\/packPlanRequests\/\{requestId\}[\s\S]*allow read, write: if false;/), 'Pack Plan idempotency requests must remain server-only');

check(contains(/match\s+\/creditLedger\/\{txnId\}[\s\S]*allow read: if hasOrgRole\(orgId, \['owner', 'admin', 'billing'\]\);[\s\S]*allow create, update, delete: if false;/), 'credit ledger must be billing-role readable and server-written only');
check(contains(/match\s+\/entitlements\/\{entitlementId\}[\s\S]*allow read: if hasOrgRole\(orgId, \['owner', 'admin', 'billing'\]\);[\s\S]*allow create, update, delete: if false;/), 'entitlements must be billing-role readable and server-written only');
check(contains(/match\s+\/\{document=\*\*\}[\s\S]*allow read, write: if false;/), 'rules must end with deny-all fallback');

if (failures.length) {
  console.error('Firestore static rules test failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Firestore static rules test passed');
