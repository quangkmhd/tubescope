import type { CrawlForm } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; }
}
export function detailMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(item => typeof item === 'object' && item !== null && 'msg' in item ? String(item.msg) : String(item)).join('; ');
  return 'Yêu cầu thất bại. Hãy thử lại.';
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError('Không kết nối được máy chủ. Kiểm tra dịch vụ TubeScope rồi thử lại.', 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.detail ? detailMessage(data.detail) : response.status >= 500 ? 'Máy chủ chưa sẵn sàng. Kiểm tra dịch vụ TubeScope rồi thử lại.' : `Yêu cầu thất bại (${response.status}).`, response.status);
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
  const sources = form.sources.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!sources.length) throw new Error('Nhập ít nhất một nguồn, mỗi nguồn trên một dòng.');
  if (sources.length > 20) throw new Error('Mỗi lượt hỗ trợ tối đa 20 nguồn.');
  const limit = form.limit.trim() === '' ? 100 : Number(form.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Giới hạn cần là số nguyên từ 1 đến 1.000.');
  const filters: Record<string, string | number | string[]> = {};
  for (const key of ['duration_min', 'duration_max', 'views_min', 'views_max', 'playlist_start', 'playlist_end'] as const) {
    if (form[key] === '') continue;
    const value = Number(form[key]);
    if (!Number.isFinite(value) || value < 0 || (key.startsWith('playlist_') && (!Number.isInteger(value) || value < 1))) throw new Error('Bộ lọc số không hợp lệ. Vị trí playlist bắt đầu từ 1.');
    filters[key] = key.startsWith('duration_') ? Math.round(value * 60) : value;
  }
  for (const [min, max] of [['duration_min', 'duration_max'], ['views_min', 'views_max'], ['playlist_start', 'playlist_end']]) {
    if (filters[min] !== undefined && filters[max] !== undefined && filters[min] > filters[max]) throw new Error('Giá trị tối thiểu không được lớn hơn tối đa.');
  }
  // Metadata durations are integer seconds; presets keep strict <3 and >20 minute boundaries.
  if (form.duration_preset === 'short') filters.duration_max = 179;
  if (form.duration_preset === 'long') filters.duration_min = 1201;
  if (form.date_after && form.date_before && form.date_after > form.date_before) throw new Error('Ngày bắt đầu phải trước ngày kết thúc.');
  for (const key of ['category', 'date_after', 'date_before', 'live_status'] as const) if (form[key]) filters[key] = form[key];
  if (form.content_types.length) filters.content_types = form.content_types;
  return { source_type: form.source_type, sources, limit, mode: form.mode, existing_policy: form.existing_policy, filters, native: ['keyword', 'search'].includes(form.source_type) ? form.native : {} };
}
const numberFormat = new Intl.NumberFormat('vi-VN');
export const count = (value: number | null | undefined) => value == null ? '—' : numberFormat.format(value);
export const duration = (seconds: number | null) => seconds == null ? '—' : seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const normalized = /^\d{8}$/.test(value) ? `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}` : value;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(d);
}
export const reviewLabels = { todo: 'Chưa xem', keep: 'Giữ lại', skip: 'Bỏ qua' };
export const jobLabels: Record<string, string> = { queued: 'Đang chờ', running: 'Đang thu thập', completed: 'Hoàn thành', partial: 'Hoàn thành một phần', failed: 'Thất bại', cancelled: 'Đã dừng', interrupted: 'Bị gián đoạn' };
