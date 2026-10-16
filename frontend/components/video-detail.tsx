'use client';

import { useState, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ExternalLink, Check, Save, LoaderCircle, Video as VideoIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FieldGroup, Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { api, count, duration, date, dateTime, reviewLabels } from '@/lib/api';
import type { Video, ReviewStatus } from '@/lib/types';
import { readReviewDraft, writeReviewDraft } from '@/lib/review-draft';

export function Thumbnail({ src, title = '', className = '' }: { src: string | null; title?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return <div className={cn("thumbnail", className)}>{src && !failed ?
    // Metadata thumbnails stay remote: TubeScope never downloads image files.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={title} width={480} height={270} loading="lazy" onError={() => setFailed(true)} /> : <VideoIcon role="img" aria-label="Không có ảnh thu nhỏ" />}</div>;
}
function Metadata({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="metadata-item"><dt>{label}</dt><dd>{children || '—'}</dd></div>;
}
function ReviewEditor({ video, refresh, onDirtyChange }: { video: Video; refresh: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const [initialDraft] = useState(() => readReviewDraft(typeof window === 'undefined' ? undefined : window.sessionStorage, video.id));
  const [status, setStatus] = useState<ReviewStatus>(initialDraft?.review_status ?? video.review_status);
  const [notes, setNotes] = useState(initialDraft?.notes ?? video.notes);
  const [tags, setTags] = useState(initialDraft?.personal_tags ?? video.personal_tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = status !== video.review_status || notes !== video.notes || tags !== video.personal_tags.join(', ');
  useEffect(() => {
    onDirtyChange(changed);
    if (!changed) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [changed, onDirtyChange]);
  function dirty(next: {status?: ReviewStatus; notes?: string; tags?: string}) {
    const value = { version: 1 as const, review_status: next.status ?? status, notes: next.notes ?? notes, personal_tags: next.tags ?? tags };
    const hasChanges = value.review_status !== video.review_status || value.notes !== video.notes || value.personal_tags !== video.personal_tags.join(', ');
    writeReviewDraft(window.sessionStorage, video.id, hasChanges ? value : null);
    onDirtyChange(hasChanges);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await api<Video>(`/api/videos/${encodeURIComponent(video.id)}/review`, { method: 'PATCH', body: JSON.stringify({ review_status: status, notes, personal_tags: tags.split(',').map(t => t.trim()).filter(Boolean) }) });
      toast.success('Đã lưu đánh giá'); writeReviewDraft(window.sessionStorage, video.id, null); onDirtyChange(false); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Chưa lưu được đánh giá.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="review-editor"><div className="review-heading"><h3>Ghi chú trong kho</h3>{changed && <Badge variant="outline">Bản nháp chưa lưu</Badge>}</div><FieldGroup className="gap-4">
    <Field><FieldLabel id="review-status-label">Đánh giá</FieldLabel><ToggleGroup type="single" variant="outline" value={status} onValueChange={v => { if(v) { setStatus(v as ReviewStatus); dirty({status: v as ReviewStatus}); } }} aria-labelledby="review-status-label" className="review-options">{Object.entries(reviewLabels).map(([value,label]) => <ToggleGroupItem value={value} key={value}>{label}</ToggleGroupItem>)}</ToggleGroup></Field>
    <Field><FieldLabel htmlFor="video-notes">Ghi chú</FieldLabel><Textarea id="video-notes" name="notes" value={notes} onChange={e => { setNotes(e.target.value); dirty({notes: e.target.value}); }} rows={4} placeholder="Điểm đáng chú ý, ý tưởng cần quay lại…" /></Field>
    <Field><FieldLabel htmlFor="personal-tags">Nhãn cá nhân</FieldLabel><Input id="personal-tags" name="personal_tags" value={tags} onChange={e => { setTags(e.target.value); dirty({tags: e.target.value}); }} placeholder="Tham khảo, ý tưởng nội dung…" /><FieldDescription>Ngăn cách bằng dấu phẩy.</FieldDescription></Field>
  </FieldGroup>{error && <Alert variant="destructive"><AlertTitle>Chưa lưu được</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}<Button type="submit" disabled={busy || !changed}>{busy ? <LoaderCircle aria-hidden="true" data-icon="inline-start" className="animate-spin" /> : <Save aria-hidden="true" data-icon="inline-start" />}{busy ? 'Đang lưu…' : 'Lưu đánh giá'}</Button></form>;
}
export function VideoDetail({ id, onClose, onRestoreFocus }: { id: string | null; onClose: () => void; onRestoreFocus: () => void }) {
  const { data: video, error, mutate: reload } = useSWR<Video>(id ? `/api/videos/${encodeURIComponent(id)}` : null, api);
  const { mutate } = useSWRConfig();
  const dirty = useRef(false);
  const refresh = () => { reload(); mutate(key => typeof key === 'string' && (key.startsWith('/api/videos?') || key.startsWith('/api/library/'))); };
  return <Sheet open={!!id} onOpenChange={open => { if (!open && (!dirty.current || window.confirm("Đánh giá chưa lưu. Đóng và bỏ bản nháp chưa lưu?"))) { if (dirty.current && id) writeReviewDraft(window.sessionStorage, id, null); dirty.current = false; onClose(); } }}><SheetContent className="video-sheet" onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}><SheetHeader><SheetTitle>Chi tiết video</SheetTitle><SheetDescription>Metadata công khai và đánh giá trong kho của bạn.</SheetDescription></SheetHeader>
    <div className="sheet-body">{error ? <Alert variant="destructive"><AlertTitle>Không tải được video</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert> : !video ? <div className="flex flex-col gap-4"><Skeleton className="aspect-video w-full" /><Skeleton className="h-8 w-4/5" /><Skeleton className="h-32 w-full" /></div> : <>
      <Thumbnail src={video.thumbnail_url} title={video.title} className="detail-thumbnail" />
      <div className="detail-heading"><h2>{video.title}</h2><p>{video.channel || 'Chưa có thông tin kênh'}{video.channel_is_verified === true && <Check aria-label="Kênh đã xác minh" />}</p><div className="flex flex-wrap gap-2"><Badge variant={video.saved ? 'secondary' : 'outline'}>{video.saved ? 'Đã lưu trong kho' : 'Chưa lưu'}</Badge><Badge variant="outline">{video.metadata_level === 'full' ? 'Metadata đầy đủ' : 'Metadata một phần'}</Badge></div></div>
      {video.saved_at && <p className="helper-line">Đã lưu vào kho: <time dateTime={video.saved_at}>{dateTime(video.saved_at)}</time></p>}
      <Button asChild variant="outline"><a href={video.url} target="_blank" rel="noreferrer">Mở trên YouTube<ExternalLink aria-hidden="true" data-icon="inline-end" /></a></Button>
      {video.saved ? <ReviewEditor key={`${video.id}-${video.updated_at}-${video.review_status}-${video.notes}`} video={video} refresh={refresh} onDirtyChange={value => { dirty.current = value; }} /> : <Alert><AlertTitle>Lưu video để bắt đầu đánh giá</AlertTitle><AlertDescription>Chọn video trong kết quả rồi bấm “Lưu vào kho”.</AlertDescription></Alert>}
      <Separator />
      <h3 className="metadata-heading">17 nhóm metadata</h3>
      <dl className="metadata-list">
        <Metadata label="01 · ID & đường dẫn"><span className="mono-value">{video.id}</span><a href={video.url} target="_blank" rel="noreferrer">{video.url}</a></Metadata>
        <Metadata label="02 · Tiêu đề">{video.title}</Metadata>
        <Metadata label="03 · Kênh"><span>{video.channel || '—'}</span><span>{video.channel_id || '—'}</span><span>{video.channel_handle || '—'}</span>{video.channel_url ? <a href={video.channel_url} target="_blank" rel="noreferrer">{video.channel_url}</a> : '—'}</Metadata>
        <Metadata label="04 · Ảnh thu nhỏ">{video.thumbnail_url ? <a href={video.thumbnail_url} target="_blank" rel="noreferrer">{video.thumbnail_url}</a> : '—'}</Metadata>
        <Metadata label="05 · Thời lượng">{duration(video.duration)}</Metadata>
        <Metadata label="06 · Lượt xem">{count(video.view_count)}</Metadata>
        <Metadata label="07 · Ngày đăng">{date(video.upload_date)}</Metadata>
        <Metadata label="08 · Nội dung & trực tiếp">{video.content_type === 'unknown' ? '—' : video.content_type}<span>{video.live_status || '—'}</span></Metadata>
        <Metadata label="09 · Danh mục">{video.categories?.join(', ') || '—'}</Metadata>
        <Metadata label="10 · Mô tả đầy đủ"><p className="full-description">{video.description || '—'}</p></Metadata>
        <Metadata label="11 · Thẻ video">{video.tags?.length ? <div className="flex flex-wrap gap-1.5">{video.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div> : '—'}</Metadata>
        <Metadata label="12 · Lượt thích">{count(video.like_count)}</Metadata>
        <Metadata label="13 · Người theo dõi kênh">{count(video.channel_follower_count)}</Metadata>
        <Metadata label="14 · Kênh đã xác minh">{video.channel_is_verified == null ? '—' : video.channel_is_verified ? 'Có' : 'Không'}</Metadata>
        <Metadata label="15 · Giấy phép">{video.license || '—'}</Metadata>
        <Metadata label="16 · Chương">{video.chapters?.length ? <ol className="chapter-list">{video.chapters.map((chapter,index) => <li key={`${chapter.start_time}-${index}`}><span>{duration(chapter.start_time)}{chapter.end_time != null ? ` – ${duration(chapter.end_time)}` : ''}</span>{chapter.title}</li>)}</ol> : '—'}</Metadata>
        <Metadata label="17 · Ngôn ngữ phụ đề">{video.subtitle_languages?.length ? <div className="flex flex-wrap gap-1.5">{video.subtitle_languages.map((lang,index) => <Badge variant="outline" key={`${lang.code}-${lang.kind}-${index}`}>{lang.name || lang.code} · {lang.kind === 'manual' ? 'Thủ công' : 'Tự động'}</Badge>)}</div> : '—'}</Metadata>
      </dl>
      <p className="helper-line">Cập nhật: {date(video.updated_at)} · Nguồn: {video.source || '—'}</p>
    </>}</div>
  </SheetContent></Sheet>;
}
