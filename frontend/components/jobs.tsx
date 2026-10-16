'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Square, RotateCcw, LoaderCircle, History, ArrowUpRight, ListVideo, Radio, CircleCheck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import { api, activeJob, count, date, dateTime, jobLabels, post, query } from '@/lib/api';
import { ErrorState, LoadingRows, Pagination } from './results';
import { Thumbnail } from './video-detail';
import type { Job, Resource, Page } from '@/lib/types';
import { elapsedLabel, jobTiming, jobReason } from '@/lib/job-timing';
import { HistoryFilters } from './history-filters';
import { groupHistoryByDay, type HistoryRange } from '@/lib/history';

const phaseLabels: Record<string,string> = { queued: 'Queued', extracting: 'Collecting metadata', discovering: 'Finding videos', enriching: 'Completing metadata', saving: 'Saving to library', completed: 'Collection complete', running: 'Processing sources', fetching: 'Querying YouTube', scanning: 'Scanning sources', filtering: 'Checking filters', cancelled: 'Collection cancelled', failed: 'Collection failed', interrupted: 'Collection interrupted', partial: 'Some sources are incomplete' };
export function JobProgress({ job, onJob, reload }: { job: Job; onJob: (job: Job) => void; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (job.status !== 'running') return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.status]);
  async function action(kind: 'cancel' | 'retry') {
    setBusy(true); setError('');
    try { const result = await post<Job>(`/api/jobs/${encodeURIComponent(job.id)}/${kind}`); if (kind === 'retry') onJob(result); else reload(); }
    catch(err) { setError(err instanceof Error ? err.message : 'Could not complete the action.'); }
    finally { setBusy(false); }
  }
  const active = activeJob(job);
  const retryable = ["partial","failed","cancelled","interrupted"].includes(job.status);
  const timing = jobTiming(job, clock || Date.parse(job.started_at || job.created_at));
  const reason = jobReason(job);
  const processed = job.processed_count ?? Math.max(0, job.scanned_count - (active ? 1 : 0));
  const progress = job.total_count && job.total_count > 0 && job.discovery_complete !== false
    ? Math.min(active ? 99 : 100, Math.round(processed / job.total_count * 100)) : active ? null : 100;
  const phase = phaseLabels[job.phase] || (job.phase.startsWith('extracting ') ? phaseLabels.extracting : jobLabels[job.status]);
  return <section className="job-progress" aria-label="Collection progress"><div className="job-top"><div className="job-caption">{active ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : ['failed','interrupted'].includes(job.status) ? <AlertCircle aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}<div><h3>{job.kind === 'save' ? 'Complete metadata & save to library' : job.kind === 'refresh' ? 'Refresh library metadata' : phase}</h3><p className="job-source">{job.sources.join(', ')}</p></div></div><Badge variant={active ? 'default' : 'secondary'}>{jobLabels[job.status]}</Badge></div>
    <div aria-live="polite" aria-atomic="true" className="job-counts"><span><strong>{count(job.scanned_count)}</strong> checked</span><span><strong>{count(job.matched_count)}</strong> matched</span><span><strong>{count(job.skipped_count)}</strong> skipped</span><span><strong>{count(job.failed_count)}</strong> errors</span>{job.total_count != null && <span>/ {count(job.total_count)} total</span>}</div>
    {job.mode === 'full' && job.prefiltered_count != null && <p className="helper-line">{count(job.prefiltered_count)} prefiltered · {count(job.detailed_count ?? 0)} detailed. Videos with missing data or views near the threshold are still checked in detail.</p>}
    <dl className="job-timing-grid">
      <div><dt>{active ? 'Elapsed time' : 'Processing time'}</dt><dd>{job.status === 'queued' ? 'Not started' : elapsedLabel(timing.elapsed)}</dd></div>
      <div><dt>Estimated time remaining</dt><dd>{job.status === 'queued' ? 'Waiting in queue' : !active ? 'Finished' : timing.remaining == null ? 'Estimating…' : `≈ ${elapsedLabel(timing.remaining)}`}</dd></div>
      <div><dt>{job.finished_at ? 'Completed at' : 'Started at'}</dt><dd>{job.finished_at || job.started_at ? <time dateTime={(job.finished_at || job.started_at)!}>{dateTime(job.finished_at || job.started_at)}</time> : 'Not started'}</dd></div>
    </dl>
    {active && <p className="helper-line">Estimates are based on the current processing speed and may change with the source and YouTube connection.</p>}
    {progress !== null ? <Progress value={progress} aria-label="Source scanning progress" /> : <p className="helper-line">Determining the total number of items in the source…</p>}
    <div className="job-bottom"><span>{date(job.created_at)} · {job.mode === 'full' ? 'Full' : 'Quick'} · Up to {count(job.limit)}/source</span>{(active || retryable) && <Button variant="outline" disabled={busy} onClick={() => action(active ? 'cancel' : 'retry')}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" data-icon="inline-start" /> : active ? <Square aria-hidden="true" data-icon="inline-start" /> : <RotateCcw aria-hidden="true" data-icon="inline-start" />}{active ? 'Cancel collection' : 'Try again'}</Button>}</div>
    {active && <p className="helper-line">Cancelling stops the collection and keeps results already collected.</p>}
    {(reason || error) && <Alert variant={job.status === 'cancelled' && !error ? 'default' : 'destructive'}><AlertTitle>{error ? 'Action incomplete' : job.status === 'cancelled' ? 'Collection cancelled' : 'Error or interruption reason'}</AlertTitle><AlertDescription>{error && <p>{error}</p>}{reason && <p className="job-reason">{reason}</p>}{job.errors.length > 0 && <details><summary>{count(job.errors.length)} errors by source/video</summary><ul className="job-errors">{job.errors.map((err,index) => <li key={index}><strong>{err.source}</strong><p>{err.message}</p></li>)}</ul></details>}</AlertDescription></Alert>}
  </section>;
}
export function ResourceResults({ job, onlySources = false }: { job: Job; onlySources?: boolean }) {
  const { data, error, mutate } = useSWR<{ items: Resource[] }>(`/api/jobs/${encodeURIComponent(job.id)}/resources`, api, { refreshInterval: activeJob(job) ? 3000 : 0 });
  const [page, setPage] = useState(1);
  if (error) return <ErrorState title="Could not load source results" error={error} retry={() => mutate()} />;
  if (!data && onlySources) return <LoadingRows />;
  if (!data?.items.length) return onlySources && !activeJob(job) ? <Empty className="research-empty"><EmptyHeader><EmptyTitle>No matching {job.search_target === 'channels' || job.source_type === 'channel' ? 'channels' : 'playlists'} found</EmptyTitle><EmptyDescription>Try different keywords or check the error details for this search.</EmptyDescription></EmptyHeader></Empty> : null;
  return <section className="resource-section"><div className="section-caption"><h3>Channels & playlists found</h3><Badge variant="secondary">{count(data.items.length)} sources</Badge></div>
    <p>Open a source on YouTube in a new tab to view the channel or playlist.</p>
    <div className="resource-grid">{data.items.slice((page-1)*24,page*24).map(resource => <article className="resource-card" key={`${resource.kind}-${resource.id}`}><Thumbnail src={resource.thumbnail_url} /><div><Badge variant="outline">{resource.kind === 'channel' ? <Radio /> : <ListVideo />}{resource.kind === 'channel' ? 'Channel' : 'Playlist'}</Badge><h4>{resource.title}</h4><Button asChild variant="outline"><a href={resource.url} target="_blank" rel="noreferrer"><ArrowUpRight aria-hidden="true" data-icon="inline-start" />Open on YouTube</a></Button></div></article>)}</div>
    {data.items.length > 24 && <Pagination page={page} pageSize={24} total={data.items.length} onChange={setPage} />}
  </section>;
}
export function JobHistory({ page, onPage, from, to, onFilter }: HistoryRange & { page: number; onPage: (page: number) => void; onFilter: (range:HistoryRange)=>void }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data, error, mutate } = useSWR<Page<Job>>(query('/api/jobs', { page, page_size: 20, date_from:from, date_to:to, time_zone:timeZone }), api, { refreshInterval: data => data?.items.some(activeJob) ? 3000 : 0 });
  const groups = groupHistoryByDay(data?.items ?? [],timeZone);
  const filtered = !!(from || to);
  return <>
    <HistoryFilters key={`${from}-${to}`} from={from} to={to} onChange={onFilter} />
    {error ? <ErrorState error={error} retry={()=>mutate()} /> : !data ? <LoadingRows /> : !data.items.length ?
      <Empty className="research-empty"><EmptyHeader><EmptyMedia variant="icon"><History /></EmptyMedia><EmptyTitle>{filtered ? 'No collections in this date range' : 'No collections yet'}</EmptyTitle><EmptyDescription>{filtered ? 'Try a different date range or clear filters to view all history.' : 'Collections, saves, and refreshes appear here so you can return to them later.'}</EmptyDescription></EmptyHeader></Empty> : <>
      <p className="history-summary" role="status">{count(data.total)} collections{filtered ? ' in the selected range' : ''} · Newest first</p>
      <div className="history-list">{groups.map(group=><section key={group.key} aria-labelledby={`history-day-${group.key}`}>
        <div className="history-day-heading"><h3 id={`history-day-${group.key}`}>{new Intl.DateTimeFormat('en-GB',{dateStyle:'full',timeZone}).format(new Date(group.items[0].created_at))}</h3><span>{group.items.length} collections on this page</span></div>
        {group.items.map(job=><article className="history-row" key={job.id}>
          <div className="history-icon">{activeJob(job) ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <History aria-hidden="true" />}</div>
          <div><h4><Link href={`/?view=discover&job=${encodeURIComponent(job.id)}`}>{job.kind === 'refresh' ? 'Refresh metadata' : job.kind === 'save' ? 'Complete metadata & save videos' : job.sources.join(', ')}</Link></h4><p><time dateTime={job.created_at}>{new Intl.DateTimeFormat('en-GB',{timeStyle:'short',timeZone}).format(new Date(job.created_at))}</time> · {count(job.scanned_count)} checked · {count(job.matched_count)} matched{job.failed_count > 0 ? ` · ${count(job.failed_count)} errors` : ''}</p>{job.error && <p className="history-error">{job.error}</p>}</div>
          <Badge variant={activeJob(job) ? 'default' : 'secondary'}>{jobLabels[job.status]}</Badge><Button asChild variant="ghost" size="icon"><Link href={`/?view=discover&job=${encodeURIComponent(job.id)}`} aria-label={`Open collection ${job.id}`}><ArrowUpRight /></Link></Button>
        </article>)}
      </section>)}</div>
      <Pagination page={page} pageSize={20} total={data.total} onChange={onPage} />
    </>}
  </>;
}
