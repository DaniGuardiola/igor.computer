import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeReadiness, helpDelivery } from '../src/readiness.mjs';

test('revoked alerts surface setup and stop promises of notification delivery', () => {
  const ready = nativeReadiness({ checkedAt: 10000, notifications: true, login: true }, 10000);
  assert.equal(ready.ready, true);
  assert.equal(helpDelivery(ready), 'notification');
  const revoked = nativeReadiness({ checkedAt: 11000, notifications: false, login: true }, 11000);
  assert.equal(revoked.ready, false);
  assert.equal(helpDelivery(revoked), 'setup-required');
  assert.match(revoked.issues[0], /notifications/);
});
test('a closed or crashed app cannot leave stale permission claims', () => {
  const status = nativeReadiness({ checkedAt: 10000, notifications: true, login: true }, 26000);
  assert.equal(status.ready, false);
  assert.equal(helpDelivery(status), 'setup-required');
});
test('missing login setup does not prevent notifications for a running app', () => {
  const status = nativeReadiness({ checkedAt: 10000, notifications: true, login: false }, 10000);
  assert.equal(status.ready, false);
  assert.equal(helpDelivery(status), 'notification');
});
