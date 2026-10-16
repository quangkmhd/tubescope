import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyResultFilters, readResultFilters, resultFilterValues, serializeResultFilters } from './result-filters';

test('filter dates and numerical ranges serialize for both API and CSV; minutes become seconds', () => {
  const values = serializeResultFilters({ ...emptyResultFilters, duration_min: '1.5', duration_max: '20', views_min: '0', likes_max: '500', category: 'unknown', saved_from: '2026-10-15', saved_to: '2026-10-16' }, 'Asia/Bangkok');
  assert.equal(values.duration_min, '90'); assert.equal(values.duration_max, '1200'); assert.equal(values.views_min, '0');
  assert.equal(values.likes_max, '500'); assert.equal(values.category, 'unknown'); assert.equal(values.time_zone, 'Asia/Bangkok');
  const params = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== null));
  assert.equal(readResultFilters(params).duration_min, '1.5');
  assert.deepEqual(resultFilterValues(params), Object.fromEntries(params));
});
test('reject reversed bounds, nonfinite or fractional counts and invalid calendar dates', () => {
  for (const update of [{ duration_min: '10', duration_max: '2' }, { views_min: 'Infinity' }, { likes_min: '1.5' }, { views_max: '-1' }, { uploaded_from: '2026-02-30' }, { saved_from: '2026-10-16', saved_to: '2026-10-15' }]) assert.throws(() => serializeResultFilters({ ...emptyResultFilters, ...update }, 'Asia/Bangkok'));
});
test('reset removes every postfilter including timezone; upload dates need no timezone', () => {
  assert.ok(Object.values(serializeResultFilters(emptyResultFilters, 'Asia/Bangkok')).every(value => value === null));
  assert.equal(serializeResultFilters({ ...emptyResultFilters, uploaded_from: '2026-10-16' }, 'Asia/Bangkok').time_zone, null);
});
test('URL values preserve all result filter options across navigation', () => {
  const params = new URLSearchParams('metadata_level=quick&live_status=is_upcoming&likes_min=0&duration_min=180&saved_from=2026-10-16&time_zone=Asia%2FBangkok');
  assert.equal(readResultFilters(params).duration_min, '3');
  assert.equal(resultFilterValues(params).metadata_level, 'quick');
  assert.equal(resultFilterValues(params).live_status, 'is_upcoming');
  assert.equal(resultFilterValues(params).time_zone, 'Asia/Bangkok');
});
