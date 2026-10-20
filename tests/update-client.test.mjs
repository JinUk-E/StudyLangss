import test from 'node:test';
import assert from 'node:assert/strict';
import { UpdateModel } from '../public/updates/app.js';

const now = Date.parse('2026-10-20T10:00:00Z');
const ready = () => ({ configured: true, available: true, phase: 'ready', checkedAt: new Date(now).toISOString(),
  current: { sha: 'a'.repeat(40) }, target: { sha: 'b'.repeat(40) }, checkToken: 'checked-token', jobId: 'old-job' });
function ownerModel() { const model = new UpdateModel(); model.authorize({ id: 'owner', isAdmin: true }); model.accept(ready()); return model; }

test('apply sends only the exact checked commit pair and token; expired checks require a new check', () => {
  const model = ownerModel();
  assert.deepEqual(model.applyPayload(now), { expectedHead: 'a'.repeat(40), targetSha: 'b'.repeat(40), checkToken: 'checked-token' });
  assert.equal(model.applyPayload(now + 600000), null);
  assert.equal(model.canCheck, true);
  model.accept({ ...ready(), checkedAt: new Date(now + 60000).toISOString() });
  assert.equal(model.canApply(now), false);
});

test('only an online owner can submit; offline and worker unavailable preserve the checked version without enabling it', () => {
  const model = ownerModel();
  model.authorize({ id: 'member', isAdmin: true }); assert.equal(model.canApply(now), false); assert.equal(model.canCheck, false);
  model.authorize({ id: 'owner', isAdmin: true, enabled: false }); assert.equal(model.canApply(now), false);
  model.authorize({ id: 'owner', isAdmin: true }); model.online = false; assert.equal(model.canApply(now), false);
  model.accept({ ...ready(), available: false }); assert.equal(model.canApply(now), false); assert.equal(model.canCheck, false);
  model.accept(ready()); assert.equal(model.canApply(now), true);
});

test('an accepted request stays locked while polling still returns the previous job', () => {
  const model = ownerModel(); model.pendingJob = 'new-job';
  model.accept(ready()); assert.equal(model.canCheck, false); assert.equal(model.canApply(now), false);
  model.accept({ ...ready(), jobId: 'new-job', phase: 'checking' }); assert.equal(model.pendingJob, null); assert.equal(model.canCheck, false);
  model.accept({ ...ready(), jobId: 'new-job' }); assert.equal(model.canApply(now), true);
  model.pendingJob = 'unclaimed-job';
  model.accept({ ...ready(), phase: 'manual' }); assert.equal(model.pendingJob, null); assert.equal(model.canCheck, false);
});

test('manual recovery and all running stages prevent both actions; failed checks can be retried', () => {
  const model = ownerModel();
  for (const phase of ['manual', 'checking', 'validating', 'stopping', 'backing-up', 'applying', 'starting']) {
    model.accept({ ...ready(), phase }); assert.equal(model.canCheck, false, phase); assert.equal(model.canApply(now), false, phase);
  }
  model.accept({ ...ready(), phase: 'failed' }); assert.equal(model.canCheck, true); assert.equal(model.canApply(now), false);
});

test('missing or unchanged commit and uncertain submission never enable apply', () => {
  const model = ownerModel();
  for (const status of [{ ...ready(), target: { sha: 'a'.repeat(40) } }, { ...ready(), current: null }, { ...ready(), checkToken: '' }]) {
    model.accept(status); assert.equal(model.canApply(now), false);
  }
  model.accept(ready()); model.uncertain = true; assert.equal(model.canApply(now), false); assert.equal(model.canCheck, false);
  model.accept(ready()); assert.equal(model.canApply(now), true);
  model.busy = true; assert.equal(model.canApply(now), false); assert.equal(model.canCheck, false);
});
