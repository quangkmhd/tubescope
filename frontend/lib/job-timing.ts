type TimingJob = {
  status: string; started_at: string | null; finished_at: string | null;
  processed_count?: number; total_count: number | null; discovery_complete?: boolean;
};
export function jobTiming(job: TimingJob, clock: number) {
  const active = job.status === 'running';
  const start = job.started_at ? Date.parse(job.started_at) : NaN;
  const end = active ? clock : job.finished_at ? Date.parse(job.finished_at) : NaN;
  const elapsed = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 1000) : null;
  const done = job.processed_count;
  const total = job.total_count;
  // Discovery and completed-candidate counts are optional for jobs created by older versions.
  const remaining = active && job.discovery_complete && elapsed != null && elapsed >= 1 &&
    done != null && done >= 3 && total != null && total > done ? elapsed / done * (total - done) : null;
  return { elapsed, remaining };
}
export function elapsedLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} giờ ${String(minutes % 60).padStart(2,'0')} phút ${String(seconds % 60).padStart(2,'0')} giây`;
  if (minutes) return `${minutes} phút ${String(seconds % 60).padStart(2,'0')} giây`;
  return `${seconds} giây`;
}
export function jobReason(job: { status: string; error: string | null; errors: {message: string; source?: string}[] }): string | null {
  if (job.error) return job.error;
  if (job.errors.length) return job.errors[0].message;
  if (job.status === 'interrupted') return 'Lượt thu thập bị gián đoạn. Phiên bản cũ không ghi lại lý do cụ thể; các kết quả đã lấy vẫn được giữ lại.';
  if (job.status === 'cancelled') return 'Đã hủy lượt thu thập. Các kết quả đã lấy vẫn được giữ lại.';
  if (job.status === 'failed' || job.status === 'partial') return 'Không có lý do lỗi được ghi lại cho lượt thu thập này.';
  return null;
}
