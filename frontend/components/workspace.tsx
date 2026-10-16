'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR, { SWRConfig, useSWRConfig } from 'swr';
import { Search, Library, History, Compass, ArrowLeft, ChevronRight, Radio, ListVideo, Shapes, Video, Database, HardDrive, RefreshCw, Check, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FieldGroup, Field, FieldLabel } from '@/components/ui/field';
import { SourcePanel } from './source-panel';
import { VideoResults, BrowseSelect, ErrorState } from './results';
import { JobHistory, JobProgress, ResourceResults } from './jobs';
import { ChannelPlaylists, GroupBrowser, groupLabels } from './warehouse';
import { VideoDetail } from './video-detail';
import { ResultFilters } from './result-filters';
import { readResultFilters, resultFilterKeys, resultFilterValues } from '@/lib/result-filters';
import { api, activeJob, count, query, keywordInput } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Catalog, GroupKind, Job, Stats } from '@/lib/types';

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) { setLastValue(value); setText(value); }
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Field className="browse-search"><FieldLabel htmlFor="browse-query" className="sr-only">Search results</FieldLabel><div className="search-field"><Search aria-hidden="true" /><Input id="browse-query" name="q" value={text} autoComplete="off" placeholder={placeholder} onChange={event => { const text = event.target.value; setText(text); clearTimeout(timer.current); timer.current = setTimeout(() => onChange(text), 400); }} /></div></Field>;
}
function WorkspaceContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const view = ['discover','library','history'].includes(params.get('view') || '') ? params.get('view')! : 'discover';
  const groupKind = (['channels','playlists','categories','all'].includes(params.get('kind') || '') ? params.get('kind') : 'channels') as GroupKind | 'all';
  const groupKey = params.get('group') || '';
  const title = params.get('title') || '';
  const jobId = params.get('job') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = params.get('q') || '';
  const status = params.get('status') || 'all';
  const contentType = params.get('content_type') || 'all';
  const sort = params.get('sort') || (view === 'library' ? 'saved' : 'arrival');
  const existing = params.get('existing') || 'all';
  const channelId = params.get('channel_id') || '';
  const channelTitle = params.get('channel_title') || '';
  const detailId = params.get('video');
  const detailTrigger = useRef<HTMLElement | null>(null);
  const { data: health, error: healthError, mutate: healthReload } = useSWR<{ status: string; yt_dlp_version: string }>('/api/health', api, { errorRetryCount: 1 });
  const { data: catalog } = useSWR<Catalog>('/api/catalog', api);
  const { data: stats, error: statsError } = useSWR<Stats>('/api/library/stats', api);
  const { data: job, error: jobError, mutate: jobReload } = useSWR<Job>(view === 'discover' && jobId ? `/api/jobs/${encodeURIComponent(jobId)}` : null, api, { refreshInterval: data => activeJob(data) ? 2000 : 0 });
  const terminalJob = useRef('');
  useEffect(() => {
    if (job && !activeJob(job) && terminalJob.current !== `${job.id}-${job.status}`) {
      terminalJob.current = `${job.id}-${job.status}`;
      mutate(key => typeof key === 'string' && (key.startsWith('/api/videos?') || key.startsWith('/api/library/') || key.endsWith('/resources')));
    }
  }, [job, mutate]);
  const navigate = useCallback((changes: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key,value] of Object.entries(changes)) { if (value === null || value === '') next.delete(key); else next.set(key, value); }
    (replace ? router.replace : router.push)(`/?${next}`, { scroll: false });
  }, [router]);
  const filter = useCallback((key: string, value: string) => navigate({ [key]: value, page: null }, true), [navigate]);
  function onJob(next: Job) {
    mutate(`/api/jobs/${next.id}`, next, false);
    router.push(query('/', { view: 'discover', job: next.id }), { scroll: false });
  }
  const sourcesOnly = view === 'discover' && !!job && (['channels','playlists'].includes(job.search_target || '') || ['channel','playlist'].includes(job.source_type) && job.sources.every(keywordInput));
  const groupsOnly = view === 'library' && groupKind !== 'all' && !groupKey;
  const videoValues: Record<string,string> = { scope: view === 'library' ? 'library' : 'job', q, sort, status, content_type: contentType, existing: view === 'library' ? 'all' : existing, ...resultFilterValues(params) };
  if (view === 'discover') videoValues.job_id = jobId;
  if (view === 'library' && groupKind !== 'all' && groupKey) { videoValues.group_kind = groupKind; videoValues.group_key = groupKey; }
  const videoKey = JSON.stringify({ ...videoValues, page });
  const breadcrumb = view === 'library' ? 'Library' : view === 'history' ? 'History' : 'Discover';
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="nav-rail"><Link href="/" className="brand"><span className="brand-mark"><Layers aria-hidden="true" /></span><span>TubeScope<span className="brand-subtitle">YouTube Library</span></span></Link>
      <nav aria-label="Main navigation" className="main-navigation"><Link className={cn('nav-item', view === 'discover' && 'active')} aria-current={view === 'discover' ? 'page' : undefined} href={jobId ? `/?view=discover&job=${encodeURIComponent(jobId)}` : '/?view=discover'}><Compass aria-hidden="true" /><span>Discover</span></Link><Link className={cn('nav-item', view === 'library' && 'active')} aria-current={view === 'library' ? 'page' : undefined} href="/?view=library"><Library aria-hidden="true" /><span>Library</span>{stats && <span className="nav-count">{count(stats.saved_count)}</span>}</Link><Link className={cn('nav-item', view === 'history' && 'active')} aria-current={view === 'history' ? 'page' : undefined} href="/?view=history"><History aria-hidden="true" /><span>History</span></Link></nav>
      <div className="rail-library"><h2>In your library</h2><Link href="/?view=library&kind=channels"><Radio aria-hidden="true" />Channels<span>{count(stats?.channel_count)}</span></Link><Link href="/?view=library&kind=playlists"><ListVideo aria-hidden="true" />Playlists<span>{count(stats?.playlist_count)}</span></Link><Link href="/?view=library&kind=categories"><Shapes aria-hidden="true" />Categories<span>{count(stats?.category_count)}</span></Link></div>
      <div className="rail-footer"><HardDrive aria-hidden="true" /><div><strong>Personal workspace</strong><span>Saved on your device</span></div><span role="img" className={cn('connection-dot', health?.status === 'ok' && 'connected')} aria-label={health?.status === 'ok' ? 'Server ready' : 'Server disconnected'} /></div>
    </aside>
    <div className="app-body"><header className="topbar"><div className="topbar-breadcrumb"><span>Workspace</span><ChevronRight aria-hidden="true" /><strong>{breadcrumb}</strong></div><Badge variant="outline"><Database aria-hidden="true" data-icon="inline-start" />Local data</Badge></header>
      <main id="main-content" tabIndex={-1} className="workspace"><div className="page-heading"><div><h1>{view === 'library' ? 'Library' : view === 'history' ? 'History' : 'Discover videos'}</h1><p>{view === 'library' ? 'Saved videos, organized by channel, playlist, and category.' : view === 'history' ? 'Review and resume previous collections.' : 'Collect metadata from YouTube and save videos to your personal library.'}</p></div><div className="heading-side"><Badge variant="secondary"><Layers aria-hidden="true" data-icon="inline-start" />17 metadata groups</Badge>{health && <span><Check aria-hidden="true" />Server ready</span>}</div></div>
      {healthError && <ErrorState title="Could not connect to the library service" error={healthError} retry={() => healthReload()} />}
      {view === 'library' && <div className="library-summary"><div><Video aria-hidden="true" /><strong>{count(stats?.saved_count)}</strong><span>saved videos</span></div><div><Radio aria-hidden="true" /><strong>{count(stats?.channel_count)}</strong><span>channels</span></div><div><ListVideo aria-hidden="true" /><strong>{count(stats?.playlist_count)}</strong><span>playlists</span></div><div><span className="status-dot" /><strong>{count(stats?.todo_count)}</strong><span>unreviewed</span></div>{statsError && <span className="summary-error">Could not load statistics</span>}</div>}
      <div className={cn('workspace-columns', view !== 'discover' && 'single-column')}>
        {view === 'discover' && <SourcePanel catalog={catalog} onJob={onJob} />}
        <section className="results-panel surface" aria-label={view === 'library' ? 'Library contents' : view === 'history' ? 'Collections' : 'Collection results'}>
          {view === 'library' && <nav className="warehouse-tabs" aria-label="Browse library">{(['channels','playlists','categories','all'] as const).map(kind => <Link className={cn(groupKind === kind && 'active')} aria-current={groupKind === kind ? 'page' : undefined} key={kind} href={query('/', { view: 'library', kind })}>{kind === 'channels' ? <Radio aria-hidden="true" /> : kind === 'playlists' ? <ListVideo aria-hidden="true" /> : kind === 'categories' ? <Shapes aria-hidden="true" /> : <Video aria-hidden="true" />}{kind === 'all' ? 'All videos' : groupLabels[kind]}</Link>)}</nav>}
          <div className="results-heading"><div><h2>{view === 'history' ? 'Recent collections' : view === 'discover' ? 'Collection results' : groupKey ? title || groupKey : channelId ? `Playlists from ${channelTitle || 'channel'}` : groupKind === 'all' ? 'All videos' : `${groupLabels[groupKind]} in your library`}</h2>{view === 'discover' && <p>{jobId ? 'Select videos to save to your library or view detailed metadata.' : 'Ready for your next discovery.'}</p>}</div><Button variant="ghost" size="icon" aria-label="Refresh data" onClick={() => mutate(key => typeof key === 'string' && key.startsWith('/api/'))}><RefreshCw /></Button></div>
          {view === 'library' && (groupKey || channelId) && <nav className="group-breadcrumb" aria-label="Library breadcrumb"><Link href={query('/', { view: 'library', kind: groupKind })}><ArrowLeft aria-hidden="true" />{groupKind === 'all' ? 'All videos' : groupLabels[groupKind]}</Link>{channelId && <><ChevronRight aria-hidden="true" /><Link href={query('/', { view: 'library', kind: 'channels', group: channelId, title: channelTitle || channelId })}>{channelTitle || 'Channel'}</Link></>}{groupKey && <><ChevronRight aria-hidden="true" /><span>{title || groupKey}</span></>}</nav>}
          {view === 'library' && groupKind === 'channels' && groupKey && <ChannelPlaylists channelId={groupKey} channelTitle={title} />}
          {jobError && <ErrorState title="Could not load collection" error={jobError} retry={() => jobReload()} />}
          {view === 'discover' && job && <><JobProgress key={`${job.id}-progress`} job={job} onJob={onJob} reload={() => jobReload()} /><ResourceResults key={`${job.id}-resources`} job={job} onlySources={sourcesOnly} /></>}
          {view !== 'history' && !sourcesOnly && (view === 'library' || jobId) && <FieldGroup className="browse-toolbar"><SearchBox value={q} onChange={value => filter('q',value)} placeholder={groupsOnly ? 'Search channels, playlists, categories…' : 'Search titles, channels, descriptions…'} />{!groupsOnly && <><BrowseSelect id="sort" label="Sort by" value={sort} onChange={v => filter('sort',v)} options={[...(view === 'discover' ? [['arrival', 'Recently collected · newest first']] as [string,string][] : []), ['views', 'Most views'], ['newest', 'Newest upload date'], ['duration', 'Shortest duration'], ['updated', 'Recently updated'], ['saved', 'Recently saved']]} /><BrowseSelect id="browse-status" label="Review status" value={status} onChange={v => filter('status',v)} options={[[ 'all', 'All review statuses'], ['todo', 'Unreviewed'], ['keep', 'Keep'], ['skip', 'Skip']]} /><BrowseSelect id="browse-type" label="Video type" value={contentType} onChange={v => filter('content_type',v)} options={[[ 'all', 'All video types'], ['video', 'Video'], ['shorts', 'Shorts'], ['livestream', 'Live']]} />{view === 'discover' && <BrowseSelect id="browse-existing" label="New or saved videos" value={existing} onChange={v => filter('existing',v)} options={[[ 'all', 'All results'], ['new', 'New videos only'], ['saved', 'Already in library']]} />}</>}</FieldGroup>}
          {view !== 'history' && !sourcesOnly && !groupsOnly && (view === 'library' || jobId) && <ResultFilters key={`${view}-${jobId}-${groupKind}-${groupKey}`} value={readResultFilters(params)} timeZone={params.get('time_zone') || ''} catalog={catalog} onApply={values => navigate({ ...values, page: null }, true)} onReset={() => navigate({ ...Object.fromEntries(resultFilterKeys.map(key => [key, null])), q: null, status: null, content_type: null, existing: null, sort: null, page: null }, true)} />}
          {view === 'history' ? <JobHistory page={page} from={params.get('history_from') || ''} to={params.get('history_to') || ''} onFilter={range=>navigate({history_from:range.from || null,history_to:range.to || null,page:null})} onPage={p => navigate({ page: String(p) })} /> : groupsOnly ? <GroupBrowser kind={groupKind as GroupKind} page={page} search={q} channelId={channelId || undefined} onPage={p => navigate({ page: String(p) })} /> : sourcesOnly ? null : <VideoResults key={videoKey} values={videoValues} page={page} onPage={p => navigate({ page: String(p) })} onDetail={id => { detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; navigate({ video: id }); }} onJob={onJob} polling={activeJob(job)} hasJob={view === 'library' || !!jobId} />}
        </section>
      </div>
      <footer className="workspace-footer"><span>YouTube Library · Personal library</span><span>Public metadata, saved on your device.</span></footer>
      </main>
    </div>
    <VideoDetail id={detailId} onClose={() => navigate({ video: null }, true)} onRestoreFocus={() => requestAnimationFrame(() => { const target = detailTrigger.current; if (target?.isConnected) target.focus(); else document.getElementById("main-content")?.focus(); })} />
  </div>;
}
export default function Workspace() { return <SWRConfig value={{ fetcher: api, dedupingInterval: 3000, revalidateOnFocus: false, errorRetryCount: 2, shouldRetryOnError: error => ![400,404,409,422].includes(error.status) }}><WorkspaceContent /></SWRConfig>; }
