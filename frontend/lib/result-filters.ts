export const resultFilterKeys = ['duration_min', 'duration_max', 'views_min', 'views_max', 'likes_min', 'likes_max', 'category', 'live_status', 'metadata_level', 'uploaded_from', 'uploaded_to', 'saved_from', 'saved_to', 'time_zone'] as const;
export type ResultFilterKey = typeof resultFilterKeys[number];
export type ResultFilterDraft = Record<Exclude<ResultFilterKey, 'time_zone'>, string>;
export const emptyResultFilters: ResultFilterDraft = { duration_min: '', duration_max: '', views_min: '', views_max: '', likes_min: '', likes_max: '', category: 'all', live_status: 'all', metadata_level: 'all', uploaded_from: '', uploaded_to: '', saved_from: '', saved_to: '' };
export class ResultFilterError extends Error {
  constructor(public field: keyof ResultFilterDraft, message: string) { super(message); this.name = 'ResultFilterError'; }
}
export function readResultFilters(params: { get: (key: string) => string | null }): ResultFilterDraft {
  const result = { ...emptyResultFilters };
  for (const key of Object.keys(result) as (keyof ResultFilterDraft)[]) {
    const value = params.get(key);
    if (value !== null && value !== '') result[key] = key.startsWith('duration_') && Number.isFinite(Number(value)) ? String(Number(value) / 60) : value;
  }
  return result;
}
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function serializeResultFilters(draft: ResultFilterDraft, timeZone: string): Record<string, string | null> {
  const result: Record<string, string | null> = Object.fromEntries(resultFilterKeys.map(key => [key, null]));
  for (const [prefix, label, minutes] of [['duration', 'Duration', true], ['views', 'Views', false], ['likes', 'Likes', false]] as const) {
    for (const bound of ['min', 'max'] as const) {
      const key = `${prefix}_${bound}` as keyof ResultFilterDraft;
      if (!draft[key].trim()) continue;
      const value = Number(draft[key]);
      if (!Number.isFinite(value) || value < 0 || (!minutes && !Number.isSafeInteger(value))) throw new ResultFilterError(key, `${label} must be a non-negative ${minutes ? 'number' : 'whole number'}.`);
      const seconds = minutes ? value * 60 : value;
      if (!Number.isFinite(seconds) || seconds > Number.MAX_SAFE_INTEGER) throw new ResultFilterError(key, `${label} exceeds the allowed limit.`);
      result[key] = String(minutes ? Math.round(seconds) : value);
    }
    const low = result[`${prefix}_min`], high = result[`${prefix}_max`];
    if (low !== null && high !== null && Number(low) > Number(high)) throw new ResultFilterError(`${prefix}_max` as keyof ResultFilterDraft, `Maximum ${label.toLowerCase()} must be greater than or equal to the minimum.`);
  }
  for (const [prefix, label] of [['uploaded', 'Upload date'], ['saved', 'Saved date']] as const) {
    for (const bound of ['from', 'to'] as const) {
      const key = `${prefix}_${bound}` as keyof ResultFilterDraft;
      if (draft[key] && !validDate(draft[key])) throw new ResultFilterError(key, `Invalid ${label.toLowerCase()}.`);
      result[key] = draft[key] || null;
    }
    if (draft[`${prefix}_from`] && draft[`${prefix}_to`] && draft[`${prefix}_from`] > draft[`${prefix}_to`]) throw new ResultFilterError(`${prefix}_to`, `The ${label.toLowerCase()} end date must not be before the start date.`);
  }
  for (const key of ['category', 'live_status', 'metadata_level'] as const) result[key] = draft[key] === 'all' ? null : draft[key] || null;
  if (result.saved_from || result.saved_to) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone }); } catch { throw new ResultFilterError('saved_from', 'Invalid time zone for the saved date filter. Reset the filters.'); }
    result.time_zone = timeZone;
  }
  return result;
}
export function resultFilterValues(params: { get: (key: string) => string | null }): Record<string, string> {
  return Object.fromEntries(resultFilterKeys.flatMap(key => { const value = params.get(key); return value && value !== 'all' ? [[key, value]] : []; }));
}
