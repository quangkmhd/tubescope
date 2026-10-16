'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { BookmarkPlus, Download, RefreshCw, ExternalLink, ChevronLeft, ChevronRight, Video as VideoIcon, Search, LoaderCircle, Check, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/components/ui/native-select';
import { Field, FieldLabel } from '@/components/ui/field';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Thumbnail } from './video-detail';
import { api, post, query, count, duration, date, dateTime, reviewLabels } from '@/lib/api';
import type { Video, Page, Job, ReviewStatus } from '@/lib/types';

export function ErrorState({ title = 'Chưa tải được dữ liệu', error, retry }: { title?: string; error: Error; retry: () => void }) {
  return <Alert variant="destructive"><AlertTitle>{title}</AlertTitle><AlertDescription><p>{error.message}</p><Button variant="outline" onClick={retry}>Thử lại</Button></AlertDescription></Alert>;
}
export function LoadingRows() { return <div className="loading-rows" role="status" aria-label="Đang tải kết quả…">{[0,1,2,3].map(i => <div className="loading-row" key={i}><Skeleton className="aspect-video w-32 shrink-0" /><div className="flex flex-1 flex-col gap-3"><Skeleton className="h-5 w-4/5" /><Skeleton className="h-4 w-2/5" /></div></div>)}</div>; }
export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="pagination" aria-label="Phân trang"><span>{total ? `${count((page-1)*pageSize+1)}–${count(Math.min(page*pageSize,total))} / ${count(total)}` : '0 kết quả'}</span><div><Button variant="outline" size="icon" aria-label="Trang trước" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft /></Button><span>Trang {count(page)} / {count(pages)}</span><Button variant="outline" size="icon" aria-label="Trang sau" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight /></Button></div></nav>;
}
export function BrowseSelect({ id, label, value, options, onChange, disabled = false }: { id: string; label: string; value: string; options: [string,string][]; onChange: (v: string) => void; disabled?: boolean }) {
  return <Field data-disabled={disabled}><FieldLabel htmlFor={id} className="sr-only">{label}</FieldLabel><NativeSelect id={id} name={id} disabled={disabled} value={value} onChange={e => onChange(e.target.value)}><NativeSelectOptGroup label={label}>{options.map(([value,label]) => <NativeSelectOption value={value} key={value}>{label}</NativeSelectOption>)}</NativeSelectOptGroup></NativeSelect></Field>;
}
export function VideoResults({ values, page, onPage, onDetail, onJob, polling = false, hasJob = true }: { values: Record<string,string>; page: number; onPage: (page: number) => void; onDetail: (id: string) => void; onJob: (job: Job) => void; polling?: boolean; hasJob?: boolean }) {
  const url = hasJob ? query('/api/videos', { ...values, page, page_size: 50 }) : null;
  const { data, error, mutate: reload } = useSWR<Page<Video>>(url, api, { refreshInterval: polling ? 2500 : 0 });
  const { mutate } = useSWRConfig();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const videos = data?.items ?? [];
  const ids = [...selected];
  const selectedVideos = videos.filter(video => selected.has(video.id));
  const library = values.scope === 'library';
  const refresh = () => { reload(); mutate(key => typeof key === 'string' && (key.startsWith('/api/library/') || key.startsWith('/api/videos?'))); };
  async function action(kind: 'save' | 'refresh' | 'review', status?: ReviewStatus) {
    setBusy(kind); setActionError('');
    try {
      if (kind === 'save') {
        const result = await post<{ saved_count: number; job_id: string | null }>('/api/library/save', { video_ids: ids });
        if (result.job_id) { onJob(await api<Job>(`/api/jobs/${encodeURIComponent(result.job_id)}`)); toast('Đang bổ sung metadata trước khi lưu'); }
        else toast.success(`Đã lưu ${count(result.saved_count)} video vào kho`);
      } else if (kind === 'refresh') {
        onJob(await post<Job>('/api/library/refresh', { video_ids: ids })); toast('Đã bắt đầu cập nhật metadata');
      } else {
        const result = await post<{ updated_count: number }>('/api/library/review', { video_ids: ids, review_status: status });
        toast.success(`Đã đánh giá ${count(result.updated_count)} video`);
      }
      setSelected(new Set()); refresh();
    } catch (err) { const message = err instanceof Error ? err.message : 'Thao tác chưa thành công.'; setActionError(message); toast.error(message); }
    finally { setBusy(''); }
  }
  function toggle(id: string) { setSelected(prev => { const next = new Set(prev); if(next.has(id)) next.delete(id); else next.add(id); return next; }); }
  if (!hasJob) return <Empty className="research-empty"><EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyTitle>Video phù hợp, trong tầm tay</EmptyTitle><EmptyDescription>Nhập từ khóa hoặc đường dẫn YouTube ở bảng nguồn. Kết quả thực tế sẽ xuất hiện tại đây.</EmptyDescription></EmptyHeader><EmptyContent><div className="empty-workflow"><span><Search aria-hidden="true" />Tìm nguồn</span><span><VideoIcon aria-hidden="true" />Khám phá video</span><span><BookmarkPlus aria-hidden="true" />Lưu vào kho</span></div></EmptyContent></Empty>;
  if (error) return <ErrorState error={error} retry={() => reload()} />;
  if (!data) return <LoadingRows />;
  if (!data.total) return <Empty className="research-empty"><EmptyHeader><EmptyMedia variant="icon"><VideoIcon /></EmptyMedia><EmptyTitle>{library ? 'Chưa có video trong chế độ xem này' : polling ? 'Đang chờ những video đầu tiên' : 'Không có video phù hợp'}</EmptyTitle><EmptyDescription>{library ? 'Lưu video từ trang Khám phá hoặc nới bộ lọc để tìm lại video trong kho.' : polling ? 'Metadata đang được kiểm tra theo từng nguồn. Bạn có thể dừng lượt thu thập bất cứ lúc nào.' : 'Kiểm tra lỗi của lượt thu thập, thử nguồn khác hoặc nới bộ lọc. Các kết quả kênh và playlist xuất hiện riêng bên trên.'}</EmptyDescription></EmptyHeader></Empty>;
  const exportUrl = query('/api/export.csv', { ...values, video_ids: ids.length ? ids.join(',') : undefined });
  return <>
    <div className="selection-bar"><label className="select-all"><Checkbox checked={videos.length > 0 && selected.size === videos.length ? true : selected.size > 0 ? 'indeterminate' : false} onCheckedChange={checked => setSelected(checked ? new Set(videos.map(v => v.id)) : new Set())} aria-label="Chọn tất cả video trên trang" /><span>{ids.length ? `Đã chọn ${count(ids.length)}` : `${count(data.total)} video`}</span></label><div className="selection-actions">
      {library ? <><BrowseSelect disabled={!ids.length || !!busy} id="bulk-review" label="Đánh giá video đã chọn" value="" options={[[ '', 'Đánh giá…'], ['todo', 'Chưa xem'], ['keep', 'Giữ lại'], ['skip', 'Bỏ qua']]} onChange={v => v && ids.length && action('review', v as ReviewStatus)} /><Button variant="outline" onClick={() => action('refresh')} disabled={!ids.length || !!busy}>{busy === 'refresh' ? <LoaderCircle aria-hidden="true" data-icon="inline-start" className="animate-spin" /> : <RefreshCw aria-hidden="true" data-icon="inline-start" />}<span>Cập nhật</span></Button></> : <Button disabled={!ids.length || !!busy} onClick={() => action('save')}>{busy === 'save' ? <LoaderCircle aria-hidden="true" data-icon="inline-start" className="animate-spin" /> : <BookmarkPlus aria-hidden="true" data-icon="inline-start" />}Lưu vào kho</Button>}
      <Button asChild variant="outline"><a href={exportUrl} download><Download aria-hidden="true" data-icon="inline-start" />CSV{ids.length ? ` (${ids.length})` : ''}</a></Button>
    </div></div>
    {actionError && <Alert variant="destructive"><AlertTitle>Thao tác chưa hoàn tất</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert>}
    <div className="video-table" role="list" aria-label="Danh sách video"><div className="table-heading" aria-hidden="true"><span>Video</span><span>Lượt xem</span><span>Ngày đăng</span><span>Trạng thái</span></div>
      {videos.map(video => <article className="video-row" key={video.id} role="listitem" data-selected={selected.has(video.id)}>
        <div className="video-main"><Checkbox checked={selected.has(video.id)} onCheckedChange={() => toggle(video.id)} aria-label={`Chọn ${video.title}`} /><button className="thumbnail-button" onClick={() => onDetail(video.id)} aria-label={`Chi tiết ${video.title} ${duration(video.duration)}`}><Thumbnail src={video.thumbnail_url} /><span className="duration-chip" aria-hidden="true">{duration(video.duration)}</span></button><div className="video-copy"><button className="video-title" onClick={() => onDetail(video.id)}>{video.title}</button><p>{video.channel || 'Chưa có kênh'}{video.channel_is_verified === true && <CircleCheck aria-label="Đã xác minh" />}</p><div className="video-labels"><span>{video.content_type === 'shorts' ? 'Shorts' : video.content_type === 'livestream' ? 'Trực tiếp' : video.content_type === 'unknown' ? 'Chưa phân loại' : 'Video'}</span>{video.metadata_level === 'quick' && <Badge variant="outline">Một phần</Badge>}<a href={video.url} target="_blank" rel="noreferrer" aria-label={`Mở ${video.title} trên YouTube`}><ExternalLink /></a></div>{video.saved && <div className="video-saved-at">{!library && <Badge variant="secondary"><Check aria-hidden="true" data-icon="inline-start" />Đã có trong kho</Badge>}<span>Đã lưu <time dateTime={video.saved_at || undefined}>{dateTime(video.saved_at)}</time></span></div>}</div></div>
        <div className="video-views"><span className="mobile-label">Lượt xem </span>{count(video.view_count)}</div><div className="video-date"><span className="mobile-label">Đăng </span>{date(video.upload_date)}</div><div className="video-status">{video.saved ? <Badge variant="secondary"><Check aria-hidden="true" data-icon="inline-start" />{reviewLabels[video.review_status]}</Badge> : <Badge variant="outline">Mới</Badge>}</div>
      </article>)}
    </div>
    {selectedVideos.length > 0 && !library && selectedVideos.some(v => v.metadata_level === 'quick') && <p className="selection-note">Video có metadata một phần sẽ được bổ sung trước khi lưu vào kho.</p>}
    <Pagination page={page} pageSize={50} total={data.total} onChange={onPage} />
  </>;
}
