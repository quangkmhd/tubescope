'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { ArrowUpRight, FolderOpen, ListVideo, Radio, Shapes, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import { Thumbnail } from './video-detail';
import { ErrorState, LoadingRows, Pagination } from './results';
import { api, query, count, dateTime } from '@/lib/api';
import type { Group, Page, GroupKind } from '@/lib/types';

export const groupLabels: Record<GroupKind, string> = { channels: 'Channels', playlists: 'Playlists', categories: 'Categories' };
export function GroupBrowser({ kind, page, search, channelId, onPage }: { kind: GroupKind; page: number; search: string; channelId?: string; onPage: (page: number) => void }) {
  const { data, error, mutate } = useSWR<Page<Group>>(query('/api/library/groups', { kind, page, page_size: 24, q: search, channel_id: channelId }), api);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <LoadingRows />;
  if (!data.items.length) return <Empty className="research-empty"><EmptyHeader><EmptyMedia variant="icon"><FolderOpen /></EmptyMedia><EmptyTitle>{search ? 'No matching sources' : channelId ? 'No known playlists in this channel' : 'Your library is ready for its first video'}</EmptyTitle><EmptyDescription>{search ? 'Try different keywords to search saved titles and sources.' : channelId ? 'Playlists appear after you collect metadata and save videos directly from a channel playlist.' : 'Save videos from Discover. Channels, playlists, and categories are organized here automatically.'}</EmptyDescription></EmptyHeader>{!channelId && !search && <Button asChild><Link href="/?view=discover">Discover videos</Link></Button>}</Empty>;
  return <><div className="group-grid">{data.items.map(group => {
    const params = new URLSearchParams({ view: 'library', kind, group: group.key, title: group.title });
    if (channelId) params.set('channel_id', channelId);
    return <Link className="group-card" href={`/?${params}`} key={group.key}><div className="group-image"><Thumbnail src={group.thumbnail_url} /><span className="group-kind-icon">{kind === 'channels' ? <Radio aria-hidden="true" /> : kind === 'playlists' ? <ListVideo aria-hidden="true" /> : <Shapes aria-hidden="true" />}</span><Badge variant="secondary">{count(group.video_count)} videos</Badge></div><div className="group-copy"><h3>{group.title}</h3><p>{group.subtitle || `${groupLabels[kind]} in your library`}</p>{group.last_saved_at && <p title={`Most recently saved video: ${dateTime(group.last_saved_at)}`}>Last saved: <time dateTime={group.last_saved_at}>{dateTime(group.last_saved_at)}</time></p>}<div><span>{count(group.unreviewed_count)} unreviewed</span><ArrowUpRight aria-hidden="true" /></div></div></Link>;
  })}</div><Pagination page={page} pageSize={24} total={data.total} onChange={onPage} /></>;
}
export function ChannelPlaylists({ channelId, channelTitle }: { channelId: string; channelTitle: string }) {
  const { data, error } = useSWR<Page<Group>>(query('/api/library/groups', { kind: 'playlists', channel_id: channelId, page: 1, page_size: 24 }), api);
  if (error) return <p className="helper-line">Could not load channel playlists: {error.message}</p>;
  if (!data) return null;
  return <section className="channel-playlists"><div><h3><ListVideo aria-hidden="true" /> Known playlists in this channel</h3>{data.items.length === 0 ? <p>No linked playlists yet. Collect metadata from a playlist to add one.</p> : <p>Only playlists linked to saved videos from this channel are included.</p>}</div>{data.items.length > 0 && <div className="playlist-links">{data.items.slice(0,4).map(group => <Button key={group.key} variant="outline" asChild><Link href={query('/', { view: 'library', kind: 'playlists', group: group.key, title: group.title, channel_id: channelId, channel_title: channelTitle })}><ListVideo aria-hidden="true" data-icon="inline-start" /><span className="truncate">{group.title}</span><Badge variant="secondary">{count(group.video_count)}</Badge></Link></Button>)}{data.total > 4 && <Button asChild variant="ghost"><Link href={query('/', { view: 'library', kind: 'playlists', channel_id: channelId, channel_title: channelTitle })}>View all {count(data.total)} playlists<ChevronRight aria-hidden="true" data-icon="inline-end" /></Link></Button>}</div>}</section>;
}
