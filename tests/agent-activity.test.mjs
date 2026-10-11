import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentActivity } from '../src/agent-activity.mjs';

test('activity expires per workspace and another action restarts the timeout', () => {
  let now = 0;
  const activity = new AgentActivity({ now: () => now });
  assert.equal(activity.state('ivo'), 'idle');
  activity.begin('ivo')();
  assert.equal(activity.state('ivo'), 'active');
  assert.equal(activity.state('doc'), 'idle');
  now = 14999;
  assert.equal(activity.state('ivo'), 'active');
  now = 15000;
  assert.equal(activity.state('ivo'), 'idle');
  activity.begin('ivo')();
  assert.equal(activity.state('ivo'), 'active');
});

test('long and overlapping commands stay active until all finish, then get an idle timeout', () => {
  let now = 0;
  const activity = new AgentActivity({ now: () => now });
  const first = activity.begin('ivo');
  const second = activity.begin('ivo');
  now = 60000;
  first();
  first(); // Completion is idempotent.
  now = 90000;
  assert.equal(activity.state('ivo'), 'active');
  second();
  now += 15000;
  assert.equal(activity.state('ivo'), 'idle');
});
