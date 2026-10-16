import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, crawlPayload, detailMessage, query, count, duration, date, dateTime, ApiError } from './api';
import { initialForm } from './types';

test('multiline sources are trimmed; duration in minutes becomes seconds', () => {
  const body = crawlPayload({ ...initialForm, sources: '  không gian nhỏ\n\nkiến trúc\n', duration_min: '3', duration_max: '20.5' });
  assert.deepEqual(body.sources, ['không gian nhỏ', 'kiến trúc']);
  assert.equal(body.filters.duration_min, 180);
  assert.equal(body.filters.duration_max, 1230);
  assert.equal(body.mode, 'full'); assert.equal(body.limit, 100);
});
test('blank optional limit defaults to 100; direct URLs ignore native search filters', () => {
  const body = crawlPayload({ ...initialForm, source_type: 'video', sources: 'https://youtu.be/abcdefghijk', limit: '' });
  assert.equal(body.limit, 100); assert.deepEqual(body.native, {});
  assert.deepEqual(body.filters, {});
});
test('reject invalid source counts, numeric ranges and reversed dates', () => {
  assert.throws(() => crawlPayload(initialForm), /at least one source/);
  assert.throws(() => crawlPayload({ ...initialForm, sources: 'x', limit: '1001' }), /limit/);
  assert.throws(() => crawlPayload({ ...initialForm, sources: 'x', duration_min: '20', duration_max: '3' }), /minimum/);
  assert.throws(() => crawlPayload({ ...initialForm, source_type:'playlist', sources:'https://www.youtube.com/playlist?list=PL_test', playlist_start: '0' }), /Playlist positions/);
  assert.throws(() => crawlPayload({ ...initialForm, sources: 'x', date_after: '2026-02-01', date_before: '2026-01-01' }), /start date/);
  assert.throws(() => crawlPayload({ ...initialForm, sources: Array.from({length:21}, (_,i) => String(i)).join('\n') }), /20 sources/);
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
  assert.equal(count(null), '—'); assert.equal(count(undefined), '—'); assert.equal(count(0),'0'); assert.equal(count(1234567), '1,234,567');
  assert.equal(date('20261016'), '16 Oct 2026'); assert.match(dateTime('2026-10-16T12:00:00Z'), /16 Oct 2026/);
  assert.equal(duration(null),'—'); assert.equal(duration(0),'0:00'); assert.equal(duration(3605),'1:00:05');
});
test('network and HTTP failures never become fabricated successful records', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(api('/api/videos'), (error: unknown) => error instanceof ApiError && error.status === 0 && /Unable to connect/.test(error.message));
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'URL phải thuộc YouTube' }), { status:422 });
    await assert.rejects(api('/api/jobs'), /URL phải thuộc YouTube/);
    globalThis.fetch = async () => new Response('Bad gateway', { status:502 });
    await assert.rejects(api('/api/health'), /server is unavailable/);
  } finally { globalThis.fetch = original; }
});

test('quick duration presets apply strict integer-second boundaries', () => {
  assert.equal(crawlPayload({ ...initialForm, sources:'x', duration_preset:'short', duration_max:'3' }).filters.duration_max,179);
  assert.equal(crawlPayload({ ...initialForm, sources:'x', duration_preset:'long', duration_min:'20' }).filters.duration_min,1201);
});

test('keywords under Video, Channel and Playlist keep the selected target and native search options', () => {
  for (const [source_type, result_type] of [['video','videos'],['channel','channels'],['playlist','playlists']] as const) {
    const body = crawlPayload({ ...initialForm, source_type, sources:'nhạc vàng', native:{...initialForm.native, result_type:'movies', order:'popularity'} });
    assert.equal(body.source_type,source_type);
    assert.equal(body.native.result_type,result_type);
    assert.equal(body.native.order,'popularity');
  }
});
test('mixed keyword and URL inputs retain their original source strings; direct-only URLs ignore native search filters', () => {
  const mixed = crawlPayload({...initialForm,source_type:'video',sources:'nhạc vàng\nhttps://youtu.be/abcdefghijk'});
  assert.deepEqual(mixed.sources,['nhạc vàng','https://youtu.be/abcdefghijk']);
  assert.equal(mixed.native.result_type,'videos');
  assert.deepEqual(crawlPayload({...initialForm,source_type:'video',sources:'https://youtu.be/abcdefghijk'}).native,{});
});
test('resource searches omit incompatible video-only native filters and source-specific hidden settings', () => {
  const body=crawlPayload({...initialForm,source_type:'playlist',sources:'nhạc vàng',playlist_start:'3',playlist_end:'20',native:{...initialForm.native,duration:'long',upload_date:'week',features:['hd']}});
  assert.deepEqual(body.native,{...initialForm.native,result_type:'playlists'});
  assert.equal(body.filters.playlist_start,undefined);
});

test('resource-only searches ignore hidden invalid video prefilters but mixed URL collection keeps them', () => {
  const body=crawlPayload({...initialForm,source_type:'channel',sources:'nhạc vàng',duration_min:'100',duration_max:'2',views_min:'NaN',duration_preset:'long',content_types:['shorts']});
  assert.deepEqual(body.filters,{});
  assert.throws(()=>crawlPayload({...initialForm,source_type:'channel',sources:'nhạc vàng\nhttps://www.youtube.com/@example',duration_min:'100',duration_max:'2'}),/minimum/);
});
