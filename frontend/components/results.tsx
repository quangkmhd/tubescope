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

export function ErrorState({ title = 'Could not load data', error, retry }: { title?: string; error: Error; retry: () => void }) {
  return <Alert variant="destructive"><AlertTitle>{title}</AlertTitle><AlertDescription><p>{error.message}</p><Button variant="outline" onClick={retry}>Try again</Button></AlertDescription></Alert>;
}
export function LoadingRows() { return <div className="loading-rows" role="status" aria-label="Loading results…">{[0,1,2,3].map(i => <div className="loading-row" key={i}><Skeleton className="aspect-video w-32 shrink-0" /><div className="flex flex-1 flex-col gap-3"><Skeleton className="h-5 w-4/5" /><Skeleton className="h-4 w-2/5" /></div></div>)}</div>; }
export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="pagination" aria-label="Pagination"><span>{total ? `${count((page-1)*pageSize+1)}–${count(Math.min(page*pageSize,total))} / ${count(total)}` : '0 results'}</span><div><Button variant="outline" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft /></Button><span>Page {count(page)} / {count(pages)}</span><Button variant="outline" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight /></Button></div></nav>;
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
        if (result.job_id) { onJob(await api<Job>(`/api/jobs/${encodeURIComponent(result.job_id)}`)); toast('Completing metadata before saving'); }
        else toast.success(`Saved ${count(result.saved_count)} videos to library`);
      } else if (kind === 'refresh') {
        onJob(await post<Job>('/api/library/refresh', { video_ids: ids })); toast('Metadata refresh started');
      } else {
        const result = await post<{ updated_count: number }>('/api/library/review', { video_ids: ids, review_status: status });
        toast.success(`Reviewed ${count(result.updated_count)} videos`);
      }
      setSelected(new Set()); refresh();
    } catch (err) { const message = err instanceof Error ? err.message : 'The action could not be completed.'; setActionError(message); toast.error(message); }
    finally { setBusy(''); }
  }
  function toggle(id: string) { setSelected(prev => { const next = new Set(prev); if(next.has(id)) next.delete(id); else next.add(id); return next; }); }
  if (!hasJob) return <Empty className="research-empty"><EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyTitle>Your next video discovery starts here</EmptyTitle><EmptyDescription>Enter keywords or YouTube URLs in the source panel. Results will appear here.</EmptyDescription></EmptyHeader><EmptyContent><div className="empty-workflow"><span><Search aria-hidden="true" />Find sources</span><span><VideoIcon aria-hidden="true" />Discover videos</span><span><BookmarkPlus aria-hidden="true" />Save to library</span></div></EmptyContent></Empty>;
  if (error) return <ErrorState error={error} retry={() => reload()} />;
  if (!data) return <LoadingRows />;
  if (!data.total) return <Empty className="research-empty"><EmptyHeader><EmptyMedia variant="icon"><VideoIcon /></EmptyMedia><EmptyTitle>{library ? 'No videos in this view' : polling ? 'Waiting for the first videos' : 'No matching videos'}</EmptyTitle><EmptyDescription>{library ? 'Save videos from Discover or broaden the filters to find videos in your library.' : polling ? 'Metadata is being checked for each source. You can cancel the collection at any time.' : 'Check collection errors, try a different source, or broaden the filters. Channel and playlist results appear separately above.'}</EmptyDescription></EmptyHeader></Empty>;
  const exportUrl = query('/api/export.csv', { ...values, video_ids: ids.length ? ids.join(',') : undefined });
  return <>
    <div className="selection-bar"><label className="select-all"><Checkbox checked={videos.length > 0 && selected.size === videos.length ? true : selected.size > 0 ? 'indeterminate' : false} onCheckedChange={checked => setSelected(checked ? new Set(videos.map(v => v.id)) : new Set())} aria-label="Select all videos on this page" /><span>{ids.length ? `Selected ${count(ids.length)}` : `${count(data.total)} videos`}</span></label><div className="selection-actions">
      {library ? <><BrowseSelect disabled={!ids.length || !!busy} id="bulk-review" label="Review selected videos" value="" options={[[ '', 'Review…'], ['todo', 'Unreviewed'], ['keep', 'Keep'], ['skip', 'Skip']]} onChange={v => v && ids.length && action('review', v as ReviewStatus)} /><Button variant="outline" onClick={() => action('refresh')} disabled={!ids.length || !!busy}>{busy === 'refresh' ? <LoaderCircle aria-hidden="true" data-icon="inline-start" className="animate-spin" /> : <RefreshCw aria-hidden="true" data-icon="inline-start" />}<span>Update</span></Button></> : <Button disabled={!ids.length || !!busy} onClick={() => action('save')}>{busy === 'save' ? <LoaderCircle aria-hidden="true" data-icon="inline-start" className="animate-spin" /> : <BookmarkPlus aria-hidden="true" data-icon="inline-start" />}Save to library</Button>}
      <Button asChild variant="outline"><a href={exportUrl} download><Download aria-hidden="true" data-icon="inline-start" />CSV{ids.length ? ` (${ids.length})` : ''}</a></Button>
    </div></div>
    {actionError && <Alert variant="destructive"><AlertTitle>Action incomplete</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert>}
    <div className="video-table" role="list" aria-label="Video list"><div className="table-heading" aria-hidden="true"><span>Video</span><span>Views</span><span>Upload date</span><span>Status</span></div>
      {videos.map(video => <article className="video-row" key={video.id} role="listitem" data-selected={selected.has(video.id)}>
        <div className="video-main"><Checkbox checked={selected.has(video.id)} onCheckedChange={() => toggle(video.id)} aria-label={`Select ${video.title}`} /><button className="thumbnail-button" onClick={() => onDetail(video.id)} aria-label={`Video details: ${video.title} ${duration(video.duration)}`}><Thumbnail src={video.thumbnail_url} /><span className="duration-chip" aria-hidden="true">{duration(video.duration)}</span></button><div className="video-copy"><button className="video-title" onClick={() => onDetail(video.id)}>{video.title}</button><p>{video.channel || 'Unknown channel'}{video.channel_is_verified === true && <CircleCheck aria-label="Verified" />}</p><div className="video-labels"><span>{video.content_type === 'shorts' ? 'Shorts' : video.content_type === 'livestream' ? 'Live' : video.content_type === 'unknown' ? 'Unknown type' : 'Video'}</span>{video.metadata_level === 'quick' && <Badge variant="outline">Quick</Badge>}<a href={video.url} target="_blank" rel="noreferrer" aria-label={`Open ${video.title} on YouTube`}><ExternalLink /></a></div>{video.saved && <div className="video-saved-at">{!library && <Badge variant="secondary"><Check aria-hidden="true" data-icon="inline-start" />Already in library</Badge>}<span>Saved <time dateTime={video.saved_at || undefined}>{dateTime(video.saved_at)}</time></span></div>}</div></div>
        <div className="video-views"><span className="mobile-label">Views </span>{count(video.view_count)}</div><div className="video-date"><span className="mobile-label">Upload date </span>{date(video.upload_date)}</div><div className="video-status">{video.saved ? <Badge variant="secondary"><Check aria-hidden="true" data-icon="inline-start" />{reviewLabels[video.review_status]}</Badge> : <Badge variant="outline">New</Badge>}</div>
      </article>)}
    </div>
    {selectedVideos.length > 0 && !library && selectedVideos.some(v => v.metadata_level === 'quick') && <p className="selection-note">Quick metadata will be completed before the videos are saved to your library.</p>}
    <Pagination page={page} pageSize={50} total={data.total} onChange={onPage} />
  </>;
}
