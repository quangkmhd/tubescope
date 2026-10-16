import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, crawlPayload, detailMessage, query, count, duration, ApiError } from './api';
import { initialForm } from './types';

test('multiline sources are trimmed; duration in minutes becomes seconds', () => {
  const body = crawlPayload({ ...initialForm, sources: '  không gian nhỏ\n\nkiến trúc\n', duration_min: '3', duration_max: '20.5' });
  assert.deepEqual(body.sources, ['không gian nhỏ', 'kiến trúc']);
  assert.equal(body.filters.duration_min, 180);
  assert.equal(body.filters.duration_max, 1230);
  assert.equal(body.mode, 'full'); assert.equal(body.limit, 100);
});
test('blank optional limit defaults to 100; native filters only for keyword/search', () => {
  const body = crawlPayload({ ...initialForm, source_type: 'video', sources: 'https://youtu.be/abcdefghijk', limit: '' });
  assert.equal(body.limit, 100); assert.deepEqual(body.native, {});
  assert.deepEqual(body.filters, {});
});
test('reject invalid source counts, numeric ranges and reversed dates', () => {
  assert.throws(() => crawlPayload(initialForm), /ít nhất một nguồn/);
  assert.throws(() => crawlPayload({ ...initialForm, sources: 'x', limit: '1001' }), /Giới hạn/);
  assert.throws(() => crawlPayload({ ...initialForm, sources: 'x', duration_min: '20', duration_max: '3' }), /tối thiểu/);
  assert.throws(() => crawlPayload({ ...initialForm, sources: 'x', playlist_start: '0' }), /Vị trí playlist/);
  assert.throws(() => crawlPayload({ ...initialForm, sources: 'x', date_after: '2026-02-01', date_before: '2026-01-01' }), /Ngày bắt đầu/);
  assert.throws(() => crawlPayload({ ...initialForm, sources: Array.from({length:21}, (_,i) => String(i)).join('\n') }), /20 nguồn/);
});
test('API error details stay readable for strings and FastAPI validation arrays', () => {
  assert.equal(detailMessage('Nguồn không hợp lệ'), 'Nguồn không hợp lệ');
  assert.equal(detailMessage([{msg:'URL không hợp lệ'},{msg:'Sai loại nguồn'}]), 'URL không hợp lệ; Sai loại nguồn');
});
test('CSV and pages preserve scope, active grouping, selection and Unicode query', () => {
  const parsed = new URL(query('/api/export.csv', { scope:'library', group_kind:'channels', group_key:'UC-test', q:'kiến trúc', status:'keep', content_type:'shorts', video_ids:'x,y' }), 'http://localhost');
  assert.equal(parsed.searchParams.get('q'), 'kiến trúc'); assert.equal(parsed.searchParams.get('video_ids'),'x,y'); assert.equal(parsed.searchParams.get('status'),'keep'); assert.equal(parsed.searchParams.get('group_key'),'UC-test');
});
test('missing numeric metadata is a dash, while real zero stays zero', () => {
  assert.equal(count(null), '—'); assert.equal(count(undefined), '—'); assert.equal(count(0),'0');
  assert.equal(duration(null),'—'); assert.equal(duration(0),'0:00'); assert.equal(duration(3605),'1:00:05');
});
test('network and HTTP failures never become fabricated successful records', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(api('/api/videos'), (error: unknown) => error instanceof ApiError && error.status === 0 && /Không kết nối/.test(error.message));
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'URL phải thuộc YouTube' }), { status:422 });
    await assert.rejects(api('/api/jobs'), /URL phải thuộc YouTube/);
    globalThis.fetch = async () => new Response('Bad gateway', { status:502 });
    await assert.rejects(api('/api/health'), /Máy chủ chưa sẵn sàng/);
  } finally { globalThis.fetch = original; }
});

test('quick duration presets apply strict integer-second boundaries', () => {
  assert.equal(crawlPayload({ ...initialForm, sources:'x', duration_preset:'short', duration_max:'3' }).filters.duration_max,179);
  assert.equal(crawlPayload({ ...initialForm, sources:'x', duration_preset:'long', duration_min:'20' }).filters.duration_min,1201);
});
