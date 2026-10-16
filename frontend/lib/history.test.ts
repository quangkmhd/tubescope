import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthRange, historyPresets, groupHistoryByDay } from './history';

test('history month and quick ranges handle leap days and year transitions', () => {
  assert.deepEqual(monthRange('2024-02'), { from:'2024-02-01', to:'2024-02-29' });
  assert.deepEqual(monthRange('2026-12'), { from:'2026-12-01', to:'2026-12-31' });
  const presets = historyPresets(new Date(2026,0,3,12));
  assert.deepEqual(presets.today, {from:'2026-01-03',to:'2026-01-03'});
  assert.deepEqual(presets.week, {from:'2025-12-28',to:'2026-01-03'});
  assert.deepEqual(presets.previous, {from:'2025-12-01',to:'2025-12-31'});
  assert.equal(monthRange('2026-13'), null);
});

test('history grouping respects the selected time zone near UTC midnight', () => {
  const rows = [{id:'new',created_at:'2026-10-16T17:00:00Z'}, {id:'old',created_at:'2026-10-16T16:59:59Z'}];
  const groups=groupHistoryByDay(rows,'Asia/Bangkok');
  assert.deepEqual(groups.map(g=>[g.key,g.items.map(j=>j.id)]), [['2026-10-17',['new']],['2026-10-16',['old']]]);
});
