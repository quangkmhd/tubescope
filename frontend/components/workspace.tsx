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
import { api, activeJob, count, query } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Catalog, GroupKind, Job, Stats } from '@/lib/types';

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) { setLastValue(value); setText(value); }
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Field className="browse-search"><FieldLabel htmlFor="browse-query" className="sr-only">Tìm trong kết quả</FieldLabel><div className="search-field"><Search aria-hidden="true" /><Input id="browse-query" name="q" value={text} autoComplete="off" placeholder={placeholder} onChange={event => { const text = event.target.value; setText(text); clearTimeout(timer.current); timer.current = setTimeout(() => onChange(text), 400); }} /></div></Field>;
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
  const sort = params.get('sort') || (view === 'library' ? 'saved' : 'views');
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
  const groupsOnly = view === 'library' && groupKind !== 'all' && !groupKey;
  const videoValues: Record<string,string> = { scope: view === 'library' ? 'library' : 'job', q, sort, status, content_type: contentType, existing: view === 'library' ? 'all' : existing };
  if (view === 'discover') videoValues.job_id = jobId;
  if (view === 'library' && groupKind !== 'all' && groupKey) { videoValues.group_kind = groupKind; videoValues.group_key = groupKey; }
  const videoKey = JSON.stringify({ ...videoValues, page });
  const breadcrumb = view === 'library' ? 'Kho nghiên cứu' : view === 'history' ? 'Lịch sử thu thập' : 'Khám phá';
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Đến nội dung chính</a>
    <aside className="nav-rail"><Link href="/" className="brand"><span className="brand-mark"><Layers aria-hidden="true" /></span><span>TubeScope<span className="brand-subtitle">Nghiên cứu YouTube</span></span></Link>
      <nav aria-label="Điều hướng chính" className="main-navigation"><Link className={cn('nav-item', view === 'discover' && 'active')} aria-current={view === 'discover' ? 'page' : undefined} href={jobId ? `/?view=discover&job=${encodeURIComponent(jobId)}` : '/?view=discover'}><Compass aria-hidden="true" /><span>Khám phá</span></Link><Link className={cn('nav-item', view === 'library' && 'active')} aria-current={view === 'library' ? 'page' : undefined} href="/?view=library"><Library aria-hidden="true" /><span>Kho nghiên cứu</span>{stats && <span className="nav-count">{count(stats.saved_count)}</span>}</Link><Link className={cn('nav-item', view === 'history' && 'active')} aria-current={view === 'history' ? 'page' : undefined} href="/?view=history"><History aria-hidden="true" /><span>Lịch sử</span></Link></nav>
      <div className="rail-library"><h2>Trong kho của bạn</h2><Link href="/?view=library&kind=channels"><Radio aria-hidden="true" />Kênh<span>{count(stats?.channel_count)}</span></Link><Link href="/?view=library&kind=playlists"><ListVideo aria-hidden="true" />Playlist<span>{count(stats?.playlist_count)}</span></Link><Link href="/?view=library&kind=categories"><Shapes aria-hidden="true" />Danh mục<span>{count(stats?.category_count)}</span></Link></div>
      <div className="rail-footer"><HardDrive aria-hidden="true" /><div><strong>Không gian cá nhân</strong><span>Lưu trên máy của bạn</span></div><span role="img" className={cn('connection-dot', health?.status === 'ok' && 'connected')} aria-label={health?.status === 'ok' ? 'Máy chủ sẵn sàng' : 'Chưa kết nối máy chủ'} /></div>
    </aside>
    <div className="app-body"><header className="topbar"><div className="topbar-breadcrumb"><span>Không gian làm việc</span><ChevronRight aria-hidden="true" /><strong>{breadcrumb}</strong></div><Badge variant="outline"><Database aria-hidden="true" data-icon="inline-start" />Dữ liệu cục bộ</Badge></header>
      <main id="main-content" tabIndex={-1} className="workspace"><div className="page-heading"><div><h1>{view === 'library' ? 'Kho nghiên cứu' : view === 'history' ? 'Lịch sử thu thập' : 'Khám phá video'}</h1><p>{view === 'library' ? 'Mọi nguồn tham khảo, được sắp xếp theo cách bạn nghiên cứu.' : view === 'history' ? 'Tiếp tục công việc từ những nguồn đã tìm kiếm.' : 'Từ một nguồn YouTube đến thư viện ý tưởng của bạn.'}</p></div><div className="heading-side"><Badge variant="secondary"><Layers aria-hidden="true" data-icon="inline-start" />17 nhóm metadata</Badge>{health && <span><Check aria-hidden="true" />Máy chủ sẵn sàng</span>}</div></div>
      {healthError && <ErrorState title="Chưa kết nối được dịch vụ TubeScope" error={healthError} retry={() => healthReload()} />}
      {view === 'library' && <div className="library-summary"><div><Video aria-hidden="true" /><strong>{count(stats?.saved_count)}</strong><span>video đã lưu</span></div><div><Radio aria-hidden="true" /><strong>{count(stats?.channel_count)}</strong><span>kênh</span></div><div><ListVideo aria-hidden="true" /><strong>{count(stats?.playlist_count)}</strong><span>playlist</span></div><div><span className="status-dot" /><strong>{count(stats?.todo_count)}</strong><span>chưa xem</span></div>{statsError && <span className="summary-error">Chưa tải được thống kê</span>}</div>}
      <div className={cn('workspace-columns', view !== 'discover' && 'single-column')}>
        {view === 'discover' && <SourcePanel catalog={catalog} onJob={onJob} />}
        <section className="results-panel surface" aria-label={view === 'library' ? 'Nội dung kho nghiên cứu' : view === 'history' ? 'Các lượt thu thập' : 'Kết quả thu thập'}>
          {view === 'library' && <nav className="warehouse-tabs" aria-label="Duyệt kho">{(['channels','playlists','categories','all'] as const).map(kind => <Link className={cn(groupKind === kind && 'active')} aria-current={groupKind === kind ? 'page' : undefined} key={kind} href={query('/', { view: 'library', kind })}>{kind === 'channels' ? <Radio aria-hidden="true" /> : kind === 'playlists' ? <ListVideo aria-hidden="true" /> : kind === 'categories' ? <Shapes aria-hidden="true" /> : <Video aria-hidden="true" />}{kind === 'all' ? 'Tất cả video' : groupLabels[kind]}</Link>)}</nav>}
          <div className="results-heading"><div><h2>{view === 'history' ? 'Các lượt gần đây' : view === 'discover' ? 'Kết quả thu thập' : groupKey ? title || groupKey : channelId ? `Playlist của ${channelTitle || 'kênh'}` : groupKind === 'all' ? 'Tất cả video' : `${groupLabels[groupKind]} trong kho`}</h2>{view === 'discover' && <p>{jobId ? 'Chọn video để lưu vào kho hoặc xem metadata chi tiết.' : 'Sẵn sàng cho lượt khám phá tiếp theo.'}</p>}</div><Button variant="ghost" size="icon" aria-label="Làm mới dữ liệu" onClick={() => mutate(key => typeof key === 'string' && key.startsWith('/api/'))}><RefreshCw /></Button></div>
          {view === 'library' && (groupKey || channelId) && <nav className="group-breadcrumb" aria-label="Đường dẫn trong kho"><Link href={query('/', { view: 'library', kind: groupKind })}><ArrowLeft aria-hidden="true" />{groupKind === 'all' ? 'Tất cả video' : groupLabels[groupKind]}</Link>{channelId && <><ChevronRight aria-hidden="true" /><Link href={query('/', { view: 'library', kind: 'channels', group: channelId, title: channelTitle || channelId })}>{channelTitle || 'Kênh'}</Link></>}{groupKey && <><ChevronRight aria-hidden="true" /><span>{title || groupKey}</span></>}</nav>}
          {view === 'library' && groupKind === 'channels' && groupKey && <ChannelPlaylists channelId={groupKey} channelTitle={title} />}
          {jobError && <ErrorState title="Chưa tải được lượt thu thập" error={jobError} retry={() => jobReload()} />}
          {view === 'discover' && job && <><JobProgress key={`${job.id}-progress`} job={job} onJob={onJob} reload={() => jobReload()} /><ResourceResults key={`${job.id}-resources`} job={job} onJob={onJob} /></>}
          {view !== 'history' && (view === 'library' || jobId) && <FieldGroup className="browse-toolbar"><SearchBox value={q} onChange={value => filter('q',value)} placeholder={groupsOnly ? 'Tìm kênh, playlist, danh mục…' : 'Tìm tiêu đề, kênh, nội dung…'} />{!groupsOnly && <><BrowseSelect id="sort" label="Sắp xếp" value={sort} onChange={v => filter('sort',v)} options={[[ 'views', 'Lượt xem cao nhất'], ['newest', 'Ngày đăng mới nhất'], ['duration', 'Thời lượng ngắn nhất'], ['updated', 'Cập nhật gần nhất'], ['saved', 'Lưu gần nhất']]} /><BrowseSelect id="browse-status" label="Đánh giá" value={status} onChange={v => filter('status',v)} options={[[ 'all', 'Mọi đánh giá'], ['todo', 'Chưa xem'], ['keep', 'Giữ lại'], ['skip', 'Bỏ qua']]} /><BrowseSelect id="browse-type" label="Loại video" value={contentType} onChange={v => filter('content_type',v)} options={[[ 'all', 'Mọi loại video'], ['video', 'Video'], ['shorts', 'Shorts'], ['livestream', 'Trực tiếp']]} />{view === 'discover' && <BrowseSelect id="browse-existing" label="Video mới hay đã lưu" value={existing} onChange={v => filter('existing',v)} options={[[ 'all', 'Tất cả kết quả'], ['new', 'Chỉ video mới'], ['saved', 'Đã có trong kho']]} />}</>}</FieldGroup>}
          {view === 'history' ? <JobHistory page={page} onPage={p => navigate({ page: String(p) })} /> : groupsOnly ? <GroupBrowser kind={groupKind as GroupKind} page={page} search={q} channelId={channelId || undefined} onPage={p => navigate({ page: String(p) })} /> : <VideoResults key={videoKey} values={videoValues} page={page} onPage={p => navigate({ page: String(p) })} onDetail={id => { detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; navigate({ video: id }); }} onJob={onJob} polling={activeJob(job)} hasJob={view === 'library' || !!jobId} />}
        </section>
      </div>
      <footer className="workspace-footer"><span>TubeScope · Không gian nghiên cứu YouTube</span><span>Metadata công khai. Ý tưởng thuộc về bạn.</span></footer>
      </main>
    </div>
    <VideoDetail id={detailId} onClose={() => navigate({ video: null }, true)} onRestoreFocus={() => requestAnimationFrame(() => { const target = detailTrigger.current; if (target?.isConnected) target.focus(); else document.getElementById("main-content")?.focus(); })} />
  </div>;
}
export default function Workspace() { return <SWRConfig value={{ fetcher: api, dedupingInterval: 3000, revalidateOnFocus: false, errorRetryCount: 2, shouldRetryOnError: error => ![400,404,409,422].includes(error.status) }}><WorkspaceContent /></SWRConfig>; }
