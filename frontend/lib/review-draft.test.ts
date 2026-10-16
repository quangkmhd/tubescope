import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReviewDraft, writeReviewDraft, reviewDraftKey } from './review-draft';

test('per-video versioned drafts preserve unsaved notes, status and tags until save/discard', () => {
  const map = new Map<string,string>();
  const storage = { getItem:(key:string) => map.get(key) ?? null, setItem:(key:string,value:string) => { map.set(key,value); }, removeItem:(key:string) => { map.delete(key); } };
  const draft = { version:1 as const, review_status:'keep' as const, notes:'Ý tưởng chưa lưu', personal_tags:'tham khảo, nội dung' };
  writeReviewDraft(storage,'video-a',draft);
  assert.deepEqual(readReviewDraft(storage,'video-a'),draft);
  assert.equal(readReviewDraft(storage,'video-b'),null);
  writeReviewDraft(storage,'video-a',null);
  assert.equal(readReviewDraft(storage,'video-a'),null);
  storage.setItem(reviewDraftKey('video-a'),'{invalid');
  assert.equal(readReviewDraft(storage,'video-a'),null);
  storage.setItem(reviewDraftKey('video-a'),JSON.stringify({...draft,version:0}));
  assert.equal(readReviewDraft(storage,'video-a'),null);
});
