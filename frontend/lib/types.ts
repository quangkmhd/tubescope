export type ReviewStatus = 'todo' | 'keep' | 'skip';
export type Video = {
  id: string; url: string; title: string; channel: string | null; channel_id: string | null;
  channel_url: string | null; channel_handle: string | null; thumbnail_url: string | null;
  duration: number | null; view_count: number | null; upload_date: string | null;
  content_type: 'video' | 'shorts' | 'livestream' | 'unknown'; live_status: string | null;
  categories: string[]; description: string | null; tags: string[]; like_count: number | null;
  channel_follower_count: number | null; channel_is_verified: boolean | null; license: string | null;
  chapters: { title: string; start_time: number; end_time: number | null }[];
  subtitle_languages: { code: string; name: string; kind: 'manual' | 'automatic' }[];
  metadata_level: 'quick' | 'full'; saved: boolean; saved_at: string | null; updated_at: string;
  review_status: ReviewStatus; notes: string; personal_tags: string[]; source: string | null;
};
export type Page<T> = { items: T[]; total: number; page: number; page_size: number };
export type Job = {
  id: string; status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
  kind: 'crawl' | 'refresh' | 'save'; source_type: string; sources: string[]; mode: string; limit: number;
  phase: string; scanned_count: number; matched_count: number; failed_count: number;
  skipped_count: number; total_count: number | null; created_at: string; started_at: string | null;
  finished_at: string | null; error: string | null; errors: { source: string; message: string }[];
};
export type Resource = { id: string; title: string; url: string; kind: 'channel' | 'playlist'; thumbnail_url: string | null };
export type Group = { key: string; title: string; subtitle: string | null; video_count: number; unreviewed_count: number; thumbnail_url: string | null };
export type GroupKind = 'channels' | 'playlists' | 'categories';
export type Stats = { saved_count: number; channel_count: number; playlist_count: number; category_count: number; todo_count: number; keep_count: number; skip_count: number };
export type Catalog = { categories: { id: string; title: string; label: string; legacy: boolean }[]; metadata_groups: string[]; native_features: { id: string; label: string }[] };
export type SourceType = 'keyword' | 'channel' | 'playlist' | 'video' | 'search';
export type CrawlForm = {
  source_type: SourceType; sources: string; limit: string; mode: 'full' | 'quick'; existing_policy: 'skip' | 'update';
  category: string; duration_preset: string; duration_min: string; duration_max: string; views_min: string; views_max: string;
  date_after: string; date_before: string; content_types: string[]; live_status: string;
  playlist_start: string; playlist_end: string;
  native: { result_type: string; order: string; upload_date: string; duration: string; features: string[] };
};
export const initialForm: CrawlForm = {
  source_type: 'keyword', sources: '', limit: '100', mode: 'full', existing_policy: 'skip',
  category: '', duration_preset: 'all', duration_min: '', duration_max: '', views_min: '', views_max: '', date_after: '', date_before: '',
  content_types: [], live_status: '', playlist_start: '', playlist_end: '',
  native: { result_type: 'videos', order: 'relevance', upload_date: 'all', duration: 'all', features: [] },
};
