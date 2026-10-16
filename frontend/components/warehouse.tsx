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

export const groupLabels: Record<GroupKind, string> = { channels: 'Kênh', playlists: 'Playlist', categories: 'Danh mục' };
export function GroupBrowser({ kind, page, search, channelId, onPage }: { kind: GroupKind; page: number; search: string; channelId?: string; onPage: (page: number) => void }) {
  const { data, error, mutate } = useSWR<Page<Group>>(query('/api/library/groups', { kind, page, page_size: 24, q: search, channel_id: channelId }), api);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <LoadingRows />;
  if (!data.items.length) return <Empty className="research-empty"><EmptyHeader><EmptyMedia variant="icon"><FolderOpen /></EmptyMedia><EmptyTitle>{search ? 'Chưa tìm thấy nguồn phù hợp' : channelId ? 'Chưa có playlist đã biết trong kênh này' : 'Kho lưu trữ đang chờ video đầu tiên'}</EmptyTitle><EmptyDescription>{search ? 'Thử từ khóa khác để tìm trong tiêu đề và nguồn đã lưu.' : channelId ? 'Playlist xuất hiện sau khi thu thập và lưu video trực tiếp từ một playlist của kênh.' : 'Lưu video từ trang Khám phá. Kênh, playlist và danh mục sẽ tự sắp xếp tại đây.'}</EmptyDescription></EmptyHeader>{!channelId && !search && <Button asChild><Link href="/?view=discover">Khám phá video</Link></Button>}</Empty>;
  return <><div className="group-grid">{data.items.map(group => {
    const params = new URLSearchParams({ view: 'library', kind, group: group.key, title: group.title });
    if (channelId) params.set('channel_id', channelId);
    return <Link className="group-card" href={`/?${params}`} key={group.key}><div className="group-image"><Thumbnail src={group.thumbnail_url} /><span className="group-kind-icon">{kind === 'channels' ? <Radio aria-hidden="true" /> : kind === 'playlists' ? <ListVideo aria-hidden="true" /> : <Shapes aria-hidden="true" />}</span><Badge variant="secondary">{count(group.video_count)} video</Badge></div><div className="group-copy"><h3>{group.title}</h3><p>{group.subtitle || `${groupLabels[kind]} trong kho lưu trữ`}</p>{group.last_saved_at && <p title={`Video được lưu gần nhất: ${dateTime(group.last_saved_at)}`}>Lưu gần nhất: <time dateTime={group.last_saved_at}>{dateTime(group.last_saved_at)}</time></p>}<div><span>{count(group.unreviewed_count)} chưa xem</span><ArrowUpRight aria-hidden="true" /></div></div></Link>;
  })}</div><Pagination page={page} pageSize={24} total={data.total} onChange={onPage} /></>;
}
export function ChannelPlaylists({ channelId, channelTitle }: { channelId: string; channelTitle: string }) {
  const { data, error } = useSWR<Page<Group>>(query('/api/library/groups', { kind: 'playlists', channel_id: channelId, page: 1, page_size: 24 }), api);
  if (error) return <p className="helper-line">Chưa tải được playlist của kênh: {error.message}</p>;
  if (!data) return null;
  return <section className="channel-playlists"><div><h3><ListVideo aria-hidden="true" /> Playlist đã biết trong kênh</h3>{data.items.length === 0 ? <p>Chưa có liên kết playlist. Thu thập từ playlist để bổ sung.</p> : <p>Chỉ gồm playlist liên quan đến video đã lưu của kênh.</p>}</div>{data.items.length > 0 && <div className="playlist-links">{data.items.slice(0,4).map(group => <Button key={group.key} variant="outline" asChild><Link href={query('/', { view: 'library', kind: 'playlists', group: group.key, title: group.title, channel_id: channelId, channel_title: channelTitle })}><ListVideo aria-hidden="true" data-icon="inline-start" /><span className="truncate">{group.title}</span><Badge variant="secondary">{count(group.video_count)}</Badge></Link></Button>)}{data.total > 4 && <Button asChild variant="ghost"><Link href={query('/', { view: 'library', kind: 'playlists', channel_id: channelId, channel_title: channelTitle })}>Xem tất cả {count(data.total)} playlist<ChevronRight aria-hidden="true" data-icon="inline-end" /></Link></Button>}</div>}</section>;
}
