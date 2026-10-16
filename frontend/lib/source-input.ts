import type { CrawlForm, SourceType } from './types';

const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const shortHosts = new Set(['youtu.be', 'www.youtu.be']);
const videoId = /^[A-Za-z0-9_-]{11}$/;
const channelTabs = new Set(['videos', 'shorts', 'streams', 'playlists', 'featured', 'community', 'live', 'releases', 'podcasts']);

// This only selects the form mode. The backend still validates every original URL.
function urlSourceType(value: string): SourceType | undefined {
  if ([...value].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hash) return;
    const parts = url.pathname.replace(/\/$/, '').slice(1).split('/');
    if (shortHosts.has(url.hostname)) return parts.length === 1 && videoId.test(parts[0]) ? 'video' : undefined;
    if (!youtubeHosts.has(url.hostname)) return;
    const query = url.searchParams;
    if (parts.length === 1 && parts[0] === 'watch' && query.getAll('v').length === 1 && videoId.test(query.get('v') || '')) return 'video';
    if (parts.length === 2 && ['shorts', 'live', 'embed'].includes(parts[0]) && videoId.test(parts[1])) return 'video';
    if (parts.length === 1 && parts[0] === 'playlist' && query.getAll('list').length === 1 && /^[A-Za-z0-9_-]{2,150}$/.test(query.get('list') || '')) return 'playlist';
    const searchQuery = query.getAll('search_query').find(Boolean) ?? query.getAll('q').find(Boolean);
    if (parts.length === 1 && parts[0] === 'results' && searchQuery?.trim()) return 'search';
    if (parts[0].startsWith('@') && parts[0].length > 1 && (parts.length === 1 || parts.length === 2 && channelTabs.has(parts[1]))) return 'channel';
    if (['channel', 'c', 'user'].includes(parts[0]) && parts[1] && (parts.length === 2 || parts.length === 3 && channelTabs.has(parts[2]))) return 'channel';
  } catch {
    // Incomplete input stays in the selected mode while the user types.
  }
}

export function normalizeSourceForm(form: CrawlForm): CrawlForm {
  const sources = form.sources.split(/\r?\n/).map(source => source.trim()).filter(Boolean);
  const types = sources.map(urlSourceType);
  const source_type = types[0];
  if (!source_type || types.some(type => type !== source_type) || source_type === form.source_type) return form;
  return {
    ...form,
    source_type,
    ...(source_type !== 'channel' ? { content_types: [] } : {}),
    ...(source_type !== 'playlist' ? { playlist_start: '', playlist_end: '' } : {}),
  };
}
