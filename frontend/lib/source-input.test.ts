import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlPayload } from './api';
import { initialForm } from './types';
import { normalizeSourceForm } from './source-input';

test('a pasted video URL overrides Search URL mode before collection', () => {
  const source = 'https://www.youtube.com/watch?v=SxLzgU77aU8';
  const body = crawlPayload({ ...initialForm, source_type: 'search', sources: source, native: { ...initialForm.native, result_type: 'channels', order: 'popularity' } });
  assert.equal(body.source_type, 'video');
  assert.deepEqual(body.sources, [source]);
  assert.deepEqual(body.native, {});
});

test('YouTube URL batches select their matching source type from any selected mode', () => {
  const cases = [
    ['https://youtu.be/SxLzgU77aU8?si=shared', 'video'],
    ['https://www.youtube.com/shorts/SxLzgU77aU8', 'video'],
    ['https://www.youtube.com/live/SxLzgU77aU8', 'video'],
    ['https://www.youtube.com/embed/SxLzgU77aU8', 'video'],
    ['https://m.youtube.com/watch?v=SxLzgU77aU8&list=PL123', 'video'],
    ['https://www.youtube.com/@example/videos', 'channel'],
    ['https://www.youtube.com/channel/UC_example/streams', 'channel'],
    ['https://www.youtube.com/c/example', 'channel'],
    ['https://www.youtube.com/user/example', 'channel'],
    ['https://www.youtube.com/playlist?list=PL123', 'playlist'],
    ['https://www.youtube.com/results?search_query=music&sp=EgIQAQ%3D%3D', 'search'],
    ['https://www.youtube.com/results?q=music', 'search'],
    ['https://www.youtube.com/results?search_query=lofi beats', 'search'],
    ['https://www.youtube.com/results?search_query=&q=music', 'search'],
  ] as const;
  for (const [source, expected] of cases) {
    const body = crawlPayload({ ...initialForm, sources: ` ${source}\r\n\n${source} ` });
    assert.equal(body.source_type, expected, source);
  }
});

test('detecting a direct video clears hidden channel and playlist settings', () => {
  const form = normalizeSourceForm({ ...initialForm, source_type: 'channel', sources: 'https://youtu.be/SxLzgU77aU8', content_types: ['shorts'], playlist_start: '3', playlist_end: '5' });
  assert.equal(form.source_type, 'video');
  assert.deepEqual(form.content_types, []);
  assert.equal(form.playlist_start, '');
  assert.equal(form.playlist_end, '');
  const body = crawlPayload(form);
  assert.equal(body.source_type, 'video');
  assert.deepEqual(body.filters, {});
});

test('keywords, incomplete URLs and mixed source types keep the chosen target', () => {
  for (const sources of ['nhạc vàng', 'nhạc vàng\nhttps://youtu.be/SxLzgU77aU8', 'https://www.youtube.com/watch?v=', 'https://example.com/watch?v=SxLzgU77aU8', 'https://www.youtube.com.evil.com/watch?v=SxLzgU77aU8', 'https://youtu.be/SxLzgU77aU8\nhttps://www.youtube.com/playlist?list=PL123']) {
    assert.equal(crawlPayload({ ...initialForm, source_type: 'channel', sources }).source_type, 'channel', sources);
  }
});
