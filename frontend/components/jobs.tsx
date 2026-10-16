'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Square, RotateCcw, LoaderCircle, History, ArrowUpRight, ListVideo, Radio, CircleCheck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import { api, activeJob, count, date, jobLabels, post, query } from '@/lib/api';
import { ErrorState, LoadingRows, Pagination } from './results';
import { Thumbnail } from './video-detail';
import type { Job, Resource, Page } from '@/lib/types';
import { HistoryFilters } from './history-filters';
import { groupHistoryByDay, type HistoryRange } from '@/lib/history';

const phaseLabels: Record<string,string> = { queued: 'Đang chờ lượt', extracting: 'Đang lấy metadata', discovering: 'Đang tìm video', enriching: 'Đang bổ sung metadata', saving: 'Đang lưu vào kho', completed: 'Thu thập hoàn tất', running: 'Đang xử lý nguồn', fetching: 'Đang truy vấn YouTube', scanning: 'Đang quét nguồn', filtering: 'Đang kiểm tra bộ lọc', cancelled: 'Đã dừng thu thập', failed: 'Lượt thu thập thất bại', interrupted: 'Lượt thu thập bị gián đoạn', partial: 'Một số nguồn chưa hoàn tất' };
export function JobProgress({ job, onJob, reload }: { job: Job; onJob: (job: Job) => void; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function action(kind: 'cancel' | 'retry') {
    setBusy(true); setError('');
    try { const result = await post<Job>(`/api/jobs/${encodeURIComponent(job.id)}/${kind}`); if (kind === 'retry') onJob(result); else reload(); }
    catch(err) { setError(err instanceof Error ? err.message : 'Không thực hiện được thao tác.'); }
    finally { setBusy(false); }
  }
  const active = activeJob(job);
  const retryable = ["partial","failed","cancelled","interrupted"].includes(job.status);
  const progress = job.total_count && job.total_count > 0 ? Math.min(100, Math.round(job.scanned_count / job.total_count * 100)) : active ? null : 100;
  return <section className="job-progress" aria-label="Tiến độ thu thập"><div className="job-top"><div className="job-caption">{active ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : ['failed','interrupted'].includes(job.status) ? <AlertCircle aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}<div><h3>{job.kind === 'save' ? 'Bổ sung metadata & lưu vào kho' : job.kind === 'refresh' ? 'Cập nhật metadata trong kho' : phaseLabels[job.phase] || job.phase || jobLabels[job.status]}</h3><p className="job-source">{job.sources.join(', ')}</p></div></div><Badge variant={active ? 'default' : 'secondary'}>{jobLabels[job.status]}</Badge></div>
    <div aria-live="polite" aria-atomic="true" className="job-counts"><span><strong>{count(job.scanned_count)}</strong> đã xét</span><span><strong>{count(job.matched_count)}</strong> phù hợp</span><span><strong>{count(job.skipped_count)}</strong> bỏ qua</span><span><strong>{count(job.failed_count)}</strong> lỗi</span>{job.total_count != null && <span>/ {count(job.total_count)} tổng</span>}</div>
    {job.mode === 'full' && job.prefiltered_count != null && <p className="helper-line">{count(job.prefiltered_count)} loại sơ bộ · {count(job.detailed_count ?? 0)} đã lấy chi tiết. Video thiếu dữ liệu hoặc sát ngưỡng lượt xem vẫn được kiểm tra chi tiết.</p>}
    {progress !== null ? <Progress value={progress} aria-label="Tiến độ quét nguồn" /> : <p className="helper-line">Đang xác định số video trong nguồn…</p>}
    <div className="job-bottom"><span>{date(job.created_at)} · {job.mode === 'full' ? 'Đầy đủ' : 'Nhanh'} · Tối đa {count(job.limit)}/nguồn</span>{(active || retryable) && <Button variant="outline" disabled={busy} onClick={() => action(active ? 'cancel' : 'retry')}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" data-icon="inline-start" /> : active ? <Square aria-hidden="true" data-icon="inline-start" /> : <RotateCcw aria-hidden="true" data-icon="inline-start" />}{active ? 'Dừng thu thập' : 'Thử lại'}</Button>}</div>
    {(job.error || job.errors.length > 0 || error) && <Alert variant="destructive"><AlertTitle>{error ? 'Thao tác chưa hoàn tất' : 'Có lỗi trong lượt thu thập'}</AlertTitle><AlertDescription>{error && <p>{error}</p>}{job.error && <p>{job.error}</p>}{job.errors.length > 0 && <details><summary>{count(job.errors.length)} lỗi theo nguồn/video</summary><ul className="job-errors">{job.errors.map((err,index) => <li key={index}><strong>{err.source}</strong><p>{err.message}</p></li>)}</ul></details>}</AlertDescription></Alert>}
  </section>;
}
export function ResourceResults({ job, onJob }: { job: Job; onJob: (job: Job) => void }) {
  const { data, error, mutate } = useSWR<{ items: Resource[] }>(`/api/jobs/${encodeURIComponent(job.id)}/resources`, api, { refreshInterval: activeJob(job) ? 3000 : 0 });
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [page, setPage] = useState(1);
  async function open(resource: Resource) {
    setBusy(resource.id); setActionError('');
    try { onJob(await post<Job>('/api/jobs', { source_type: resource.kind, sources: [resource.url], mode: 'full', limit: 100, existing_policy: 'skip', filters: {}, native: {} })); }
    catch(err) { setActionError(err instanceof Error ? err.message : 'Không mở được nguồn.'); }
    finally { setBusy(''); }
  }
  if (error) return <ErrorState title="Chưa tải được kết quả nguồn" error={error} retry={() => mutate()} />;
  if (!data?.items.length) return null;
  return <section className="resource-section"><div className="section-caption"><h3>Kênh & playlist tìm thấy</h3><Badge variant="secondary">{count(data.items.length)} nguồn</Badge></div><p>Mở một nguồn để bắt đầu thu thập video trong đó.</p>{actionError && <Alert variant="destructive"><AlertTitle>Chưa mở được nguồn</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert>}<div className="resource-grid">{data.items.slice((page-1)*24,page*24).map(resource => <article className="resource-card" key={`${resource.kind}-${resource.id}`}><Thumbnail src={resource.thumbnail_url} /><div><Badge variant="outline">{resource.kind === 'channel' ? <Radio /> : <ListVideo />}{resource.kind === 'channel' ? 'Kênh' : 'Playlist'}</Badge><h4>{resource.title}</h4><Button variant="outline" disabled={!!busy} onClick={() => open(resource)}>{busy === resource.id ? <LoaderCircle className="animate-spin" aria-hidden="true" data-icon="inline-start" /> : <ArrowUpRight aria-hidden="true" data-icon="inline-start" />}Mở nguồn</Button></div></article>)}</div>{data.items.length > 24 && <Pagination page={page} pageSize={24} total={data.items.length} onChange={setPage} />}</section>;
}
export function JobHistory({ page, onPage, from, to, onFilter }: HistoryRange & { page: number; onPage: (page: number) => void; onFilter: (range:HistoryRange)=>void }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data, error, mutate } = useSWR<Page<Job>>(query('/api/jobs', { page, page_size: 20, date_from:from, date_to:to, time_zone:timeZone }), api, { refreshInterval: data => data?.items.some(activeJob) ? 3000 : 0 });
  const groups = groupHistoryByDay(data?.items ?? [],timeZone);
  const filtered = !!(from || to);
  return <>
    <HistoryFilters key={`${from}-${to}`} from={from} to={to} onChange={onFilter} />
    {error ? <ErrorState error={error} retry={()=>mutate()} /> : !data ? <LoadingRows /> : !data.items.length ?
      <Empty className="research-empty"><EmptyHeader><EmptyMedia variant="icon"><History /></EmptyMedia><EmptyTitle>{filtered ? 'Không có lượt thu thập trong khoảng ngày này' : 'Chưa có lượt thu thập'}</EmptyTitle><EmptyDescription>{filtered ? 'Thử khoảng thời gian khác hoặc xóa bộ lọc để xem toàn bộ lịch sử.' : 'Các lượt thu thập, lưu và cập nhật sẽ được lưu ở đây để bạn tiếp tục sau.'}</EmptyDescription></EmptyHeader></Empty> : <>
      <p className="history-summary" role="status">{count(data.total)} lượt thu thập{filtered ? ' trong khoảng đã chọn' : ''} · Mới nhất trước</p>
      <div className="history-list">{groups.map(group=><section key={group.key} aria-labelledby={`history-day-${group.key}`}>
        <div className="history-day-heading"><h3 id={`history-day-${group.key}`}>{new Intl.DateTimeFormat('vi-VN',{dateStyle:'full',timeZone}).format(new Date(group.items[0].created_at))}</h3><span>{group.items.length} lượt trên trang</span></div>
        {group.items.map(job=><article className="history-row" key={job.id}>
          <div className="history-icon">{activeJob(job) ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <History aria-hidden="true" />}</div>
          <div><h4><Link href={`/?view=discover&job=${encodeURIComponent(job.id)}`}>{job.kind === 'refresh' ? 'Cập nhật metadata' : job.kind === 'save' ? 'Bổ sung & lưu video' : job.sources.join(', ')}</Link></h4><p><time dateTime={job.created_at}>{new Intl.DateTimeFormat('vi-VN',{timeStyle:'short',timeZone}).format(new Date(job.created_at))}</time> · {count(job.scanned_count)} đã xét · {count(job.matched_count)} phù hợp{job.failed_count > 0 ? ` · ${count(job.failed_count)} lỗi` : ''}</p>{job.error && <p className="history-error">{job.error}</p>}</div>
          <Badge variant={activeJob(job) ? 'default' : 'secondary'}>{jobLabels[job.status]}</Badge><Button asChild variant="ghost" size="icon"><Link href={`/?view=discover&job=${encodeURIComponent(job.id)}`} aria-label={`Mở lượt thu thập ${job.id}`}><ArrowUpRight /></Link></Button>
        </article>)}
      </section>)}</div>
      <Pagination page={page} pageSize={20} total={data.total} onChange={onPage} />
    </>}
  </>;
}
