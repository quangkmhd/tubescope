import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobTiming, elapsedLabel, jobReason } from './job-timing';

const start = '2026-10-16T00:00:00Z';
const clock = Date.parse(start) + 60_000;
const running = { status: 'running', started_at: start, finished_at: null, processed_count: 6, total_count: 12, discovery_complete: true };

test('elapsed time ticks while running and freezes at the actual terminal timestamp', () => {
  assert.equal(jobTiming(running, clock).elapsed, 60);
  assert.equal(jobTiming({ ...running, status:'completed', finished_at:'2026-10-16T00:00:30Z' }, clock).elapsed, 30);
  assert.equal(jobTiming({ ...running, status:'queued', started_at:null }, clock).elapsed, null);
  assert.equal(jobTiming({ ...running, started_at:'invalid' }, clock).elapsed, null);
  assert.equal(jobTiming({ ...running, status:'interrupted', finished_at:null }, clock).elapsed, null);
});

test('ETA uses completed candidates, only after discovery and enough samples', () => {
  assert.equal(jobTiming(running, clock).remaining, 60);
  for (const patch of [{ discovery_complete:false }, { processed_count:2 }, { total_count:null }, { processed_count:undefined }, { status:'cancelled' }, { processed_count:12 }]) {
    assert.equal(jobTiming({ ...running, ...patch }, clock).remaining, null);
  }
  assert.equal(jobTiming({ ...running, started_at:'2026-10-16T00:02:00Z' }, clock).elapsed, 0);
  assert.equal(jobTiming({ ...running, started_at:'2026-10-16T00:02:00Z' }, clock).remaining, null);
});

test('long runtimes and missing values stay readable without NaN or negative times', () => {
  assert.equal(elapsedLabel(3661), '1 giờ 01 phút 01 giây');
  assert.equal(elapsedLabel(61), '1 phút 01 giây');
  assert.equal(elapsedLabel(0), '0 giây');
  assert.equal(elapsedLabel(null), '—');
});

test('error explanations preserve exact source reasons and never invent legacy interruption causes', () => {
  assert.equal(jobReason({ status:'failed', error:null, errors:[{source:'x',message:'Video unavailable'}] }), 'Video unavailable');
  assert.equal(jobReason({ status:'failed', error:'HTTP 429', errors:[] }), 'HTTP 429');
  assert.match(jobReason({ status:'interrupted', error:null, errors:[] })!, /không ghi lại lý do/);
  assert.match(jobReason({ status:'cancelled', error:null, errors:[] })!, /Đã hủy/);
  assert.equal(jobReason({ status:'completed', error:null, errors:[] }), null);
});
