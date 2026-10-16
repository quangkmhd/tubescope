import type { CrawlForm, SourceType } from './types';
import { normalizeSourceForm } from './source-input';

export const searchTargets: Partial<Record<SourceType, CrawlForm['native']['result_type']>> = { video:'videos', channel:'channels', playlist:'playlists' };
export const keywordInput = (value: string) => !/(?:[a-z][a-z0-9+.-]*:\/\/|www\.|youtu\.be\/|youtube\.com\/|(?:javascript|data|file|mailto):)/i.test(value);
export function searchOptions(form: CrawlForm): CrawlForm['native'] {
  const result_type = searchTargets[form.source_type] || form.native.result_type;
  if (['channels','playlists'].includes(result_type)) return { result_type, order:form.native.order, upload_date:'all', duration:'all', features:[] };
  return { ...form.native, result_type };
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; }
}
export function detailMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(item => typeof item === 'object' && item !== null && 'msg' in item ? String(item.msg) : String(item)).join('; ');
  return 'Request failed. Please try again.';
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError('Unable to connect to the server. Check the TubeScope service and try again.', 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.detail ? detailMessage(data.detail) : response.status >= 500 ? 'The server is unavailable. Check the TubeScope service and try again.' : `Request failed (${response.status}).`, response.status);
  }
  return response.json();
}
export const post = <T>(path: string, data?: unknown) => api<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });
export const activeJob = (job?: { status: string }) => !!job && ['queued', 'running'].includes(job.status);
export function query(path: string, values: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)); });
  return `${path}?${params}`;
}
export function crawlPayload(form: CrawlForm) {
  form = normalizeSourceForm(form);
  const sources = form.sources.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!sources.length) throw new Error('Enter at least one source, one per line.');
  if (sources.length > 20) throw new Error('Each collection supports up to 20 sources.');
  const hasDirectSource = sources.some(source => !keywordInput(source));
  const usesSearch = ['keyword','search'].includes(form.source_type) || !!searchTargets[form.source_type] && sources.some(keywordInput);
  const options = searchOptions(form);
  const resourcesOnly = usesSearch && ['channels','playlists'].includes(options.result_type) && !(searchTargets[form.source_type] && hasDirectSource);
  const limit = form.limit.trim() === '' ? 100 : Number(form.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('The limit must be a whole number from 1 to 1,000.');
  const filters: Record<string, string | number | string[]> = {};
  for (const key of ['duration_min', 'duration_max', 'views_min', 'views_max', 'playlist_start', 'playlist_end'] as const) {
    if (key.startsWith('playlist_') && (form.source_type !== 'playlist' || !hasDirectSource)) continue;
    if (resourcesOnly && (key.startsWith('duration_') || key.startsWith('views_'))) continue;
    if (form[key] === '') continue;
    const value = Number(form[key]);
    if (!Number.isFinite(value) || value < 0 || (key.startsWith('playlist_') && (!Number.isInteger(value) || value < 1))) throw new Error('Invalid numeric filter. Playlist positions start at 1.');
    filters[key] = key.startsWith('duration_') ? Math.round(value * 60) : value;
  }
  for (const [min, max] of [['duration_min', 'duration_max'], ['views_min', 'views_max'], ['playlist_start', 'playlist_end']]) {
    if (filters[min] !== undefined && filters[max] !== undefined && filters[min] > filters[max]) throw new Error('The minimum must not exceed the maximum.');
  }
  // Metadata durations are integer seconds; presets keep strict <3 and >20 minute boundaries.
  if (!resourcesOnly && form.duration_preset === 'short') filters.duration_max = 179;
  if (!resourcesOnly && form.duration_preset === 'long') filters.duration_min = 1201;
  if (form.date_after && form.date_before && form.date_after > form.date_before) throw new Error('The start date must not be after the end date.');
  for (const key of ['category', 'date_after', 'date_before', 'live_status'] as const) if (form[key]) filters[key] = form[key];
  if (form.content_types.length && form.source_type === 'channel' && hasDirectSource) filters.content_types = form.content_types;
  const native: Partial<CrawlForm['native']> = usesSearch ? options : {};
  return { source_type: form.source_type, sources, limit, mode: form.mode, existing_policy: form.existing_policy, filters, native };
}
const numberFormat = new Intl.NumberFormat('en-US');
export const count = (value: number | null | undefined) => value == null ? '—' : numberFormat.format(value);
export const duration = (seconds: number | null) => seconds == null ? '—' : seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const normalized = /^\d{8}$/.test(value) ? `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}` : value;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(d);
}
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', { dateStyle:'medium', timeStyle:'medium' }).format(parsed);
}
export const reviewLabels = { todo: 'Not reviewed', keep: 'Keep', skip: 'Skip' };
export const jobLabels: Record<string, string> = { queued: 'Queued', running: 'Collecting', completed: 'Completed', partial: 'Partially completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' };
