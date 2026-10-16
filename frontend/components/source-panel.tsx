'use client';

import { useState } from 'react';
import { Play, SlidersHorizontal, Search, Info, LoaderCircle, ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption, NativeSelectOptGroup } from '@/components/ui/native-select';
import { Field, FieldLabel, FieldDescription, FieldGroup, FieldSet, FieldLegend } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { Catalog, CrawlForm, Job, SourceType } from '@/lib/types';
import { initialForm } from '@/lib/types';
import { crawlPayload, post } from '@/lib/api';

const sourceLabels: Record<SourceType, string> = { keyword: 'Từ khóa', channel: 'Kênh', playlist: 'Playlist', video: 'Video', search: 'URL tìm kiếm' };
const placeholders: Record<SourceType, string> = {
  keyword: 'Ví dụ: thiết kế không gian nhỏ\nkiến trúc bền vững…', channel: 'https://www.youtube.com/@tenkenh/videos…',
  playlist: 'https://www.youtube.com/playlist?list=…', video: 'https://www.youtube.com/watch?v=…', search: 'https://www.youtube.com/results?search_query=…',
};
function SelectField({ id, label, value, options, onChange, disabled = false }: { id: string; label: string; value: string; options: [string,string][]; onChange: (value: string) => void; disabled?: boolean }) {
  return <Field data-disabled={disabled}><FieldLabel htmlFor={id}>{label}</FieldLabel><NativeSelect id={id} name={id} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}><NativeSelectOptGroup label={label}>{options.map(([key, text]) => <NativeSelectOption key={key} value={key}>{text}</NativeSelectOption>)}</NativeSelectOptGroup></NativeSelect></Field>;
}
export function SourcePanel({ catalog, onJob }: { catalog?: Catalog; onJob: (job: Job) => void }) {
  const [form, setForm] = useState<CrawlForm>(initialForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nativeOpen, setNativeOpen] = useState(false);
  const [customLimit, setCustomLimit] = useState(false);
  const update = <K extends keyof CrawlForm>(key: K, value: CrawlForm[K]) => setForm(prev => ({ ...prev, [key]: value, ...(['duration_min','duration_max'].includes(key) ? { duration_preset: 'custom' } : {}) }));
  const native = (key: keyof CrawlForm['native'], value: string | string[]) => setForm(prev => ({ ...prev, native: { ...prev.native, [key]: value } }));
  const nativeAllowed = ['keyword', 'search'].includes(form.source_type);
  const nativeCount = (form.native.result_type !== 'videos' ? 1 : 0) + (form.native.order !== 'relevance' ? 1 : 0) + (form.native.upload_date !== 'all' ? 1 : 0) + (form.native.duration !== 'all' ? 1 : 0) + form.native.features.length;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try {
      const body = crawlPayload(form);
      setBusy(true);
      onJob(await post<Job>('/api/jobs', body));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được lượt thu thập.');
      document.getElementById('sources')?.focus();
    } finally { setBusy(false); }
  }
  return <aside className="source-panel surface" aria-labelledby="source-heading">
    <div className="panel-heading"><div className="heading-icon"><Search aria-hidden="true" /></div><div><h2 id="source-heading">Nguồn thu thập</h2><p>Bắt đầu từ điều bạn muốn tìm.</p></div></div>
    <p className="optional-legend"><span className="required">*</span> Bắt buộc · Các mục khác không bắt buộc</p>
    <form onSubmit={submit} onInvalidCapture={event => { const disclosure = (event.target as HTMLElement).closest("details"); if (disclosure) disclosure.open = true; }} className="flex flex-col gap-6">
      <FieldGroup className="gap-5">
        <SelectField id="source-type" label="Loại nguồn" value={form.source_type} onChange={v => update('source_type', v as SourceType)} options={Object.entries(sourceLabels) as [string,string][]} />
        <Field data-invalid={!!error}><FieldLabel htmlFor="sources">{sourceLabels[form.source_type]} <span className="required">*</span></FieldLabel><Textarea id="sources" name="sources" required aria-invalid={!!error} value={form.sources} onChange={e => update('sources', e.target.value)} placeholder={placeholders[form.source_type]} rows={4} spellCheck={false} autoComplete="off" /><FieldDescription>Mỗi nguồn một dòng, tối đa 20 nguồn.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="source-limit">Giới hạn mỗi nguồn</FieldLabel><NativeSelect id="source-limit" name="limit" value={customLimit ? "custom" : form.limit} onChange={e => { setCustomLimit(e.target.value === "custom"); update('limit', e.target.value === "custom" ? "" : e.target.value); }}><NativeSelectOptGroup label="Số video mỗi nguồn">{[25,50,100,200,500,1000].map(n => <NativeSelectOption key={n} value={String(n)}>{n} video</NativeSelectOption>)}<NativeSelectOption value="custom">Số lượng tùy chỉnh</NativeSelectOption></NativeSelectOptGroup></NativeSelect>{customLimit && <Input aria-label="Giới hạn tùy chỉnh" name="custom_limit" type="number" min={1} max={1000} step={1} value={form.limit} onChange={e => update('limit', e.target.value)} placeholder="Mặc định 100…" />}<FieldDescription>Tối đa 1.000 video, tính trước khi lọc.</FieldDescription></Field>
        <Field><FieldLabel id="mode-label">Chế độ metadata</FieldLabel><ToggleGroup type="single" value={form.mode} onValueChange={v => v && update('mode', v as 'full'|'quick')} aria-labelledby="mode-label" variant="outline" className="segmented"><ToggleGroupItem value="full">Đầy đủ</ToggleGroupItem><ToggleGroupItem value="quick">Nhanh</ToggleGroupItem></ToggleGroup><FieldDescription>{form.mode === 'full' ? 'Lấy đủ 17 nhóm thông tin để nghiên cứu.' : 'Metadata một phần. Khi lưu, hệ thống sẽ bổ sung đầy đủ.'}</FieldDescription></Field>

      </FieldGroup>
      {error && <Alert variant="destructive"><AlertTitle>Chưa thể bắt đầu</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      <Button type="submit" disabled={busy} className="start-button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" data-icon="inline-start" /> : <Play aria-hidden="true" data-icon="inline-start" />}{busy ? 'Đang bắt đầu…' : 'Thu thập video'}</Button>
      <details className="advanced-filters"><summary><span>Bộ lọc nâng cao</span></summary><div className="filter-section">
        <h3><ListFilter aria-hidden="true" /> Bộ lọc sau thu thập</h3>
        <p>Áp dụng cho metadata video thực tế.</p>
        <FieldGroup className="gap-5">
        <Field><FieldLabel id="existing-label">Video đã có trong kho</FieldLabel><ToggleGroup type="single" value={form.existing_policy} onValueChange={v => v && update('existing_policy', v as 'skip'|'update')} aria-labelledby="existing-label" variant="outline" className="segmented"><ToggleGroupItem value="skip">Bỏ qua</ToggleGroupItem><ToggleGroupItem value="update">Cập nhật</ToggleGroupItem></ToggleGroup><FieldDescription>Đánh giá và ghi chú cá nhân được giữ lại.</FieldDescription></Field>
          <SelectField id="duration-preset" label="Mốc thời lượng" value={form.duration_preset} onChange={v => { const range = v === 'short' ? ['', '3'] : v === 'medium' ? ['3', '20'] : v === 'long' ? ['20',''] : ['','']; setForm(prev => ({ ...prev, duration_preset: v, duration_min: range[0], duration_max: range[1] })); }} options={[[ 'all', 'Mọi thời lượng'], ['short', 'Dưới 3 phút'], ['medium', '3–20 phút'], ['long', 'Trên 20 phút'], ['custom', 'Tùy chỉnh bên dưới']]} />
          <FieldSet><FieldLegend variant="label">Thời lượng (phút)</FieldLegend><FieldGroup className="range-fields"><Field><FieldLabel htmlFor="duration-min" className="sr-only">Thời lượng tối thiểu (phút)</FieldLabel><Input id="duration-min" name="duration_min" type="number" min="0" step="0.1" value={form.duration_min} onChange={e => update('duration_min', e.target.value)} placeholder="Từ…" /></Field><span aria-hidden="true">–</span><Field><FieldLabel htmlFor="duration-max" className="sr-only">Thời lượng tối đa (phút)</FieldLabel><Input id="duration-max" name="duration_max" type="number" min="0" step="0.1" value={form.duration_max} onChange={e => update('duration_max', e.target.value)} placeholder="Đến…" /></Field></FieldGroup></FieldSet>
          <SelectField id="views-preset" label="Mốc lượt xem tối thiểu" value={form.views_min || 'all'} onChange={v => update('views_min', v === 'all' ? '' : v)} options={[[ 'all', 'Mọi lượt xem'], ['1000', 'Từ 1.000'], ['10000', 'Từ 10.000'], ['100000', 'Từ 100.000'], ['1000000', 'Từ 1.000.000'], ...(!['','1000','10000','100000','1000000'].includes(form.views_min) ? [[form.views_min, 'Tùy chỉnh']] as [string,string][] : [])]} />
          <FieldSet><FieldLegend variant="label">Lượt xem</FieldLegend><FieldGroup className="range-fields"><Field><FieldLabel htmlFor="views-min" className="sr-only">Lượt xem tối thiểu</FieldLabel><Input id="views-min" name="views_min" type="number" min="0" value={form.views_min} onChange={e => update('views_min', e.target.value)} placeholder="Từ…" /></Field><span aria-hidden="true">–</span><Field><FieldLabel htmlFor="views-max" className="sr-only">Lượt xem tối đa</FieldLabel><Input id="views-max" name="views_max" type="number" min="0" value={form.views_max} onChange={e => update('views_max', e.target.value)} placeholder="Đến…" /></Field></FieldGroup></FieldSet>
          <Field><FieldLabel htmlFor="category">Danh mục</FieldLabel><NativeSelect id="category" name="category" value={form.category} onChange={e => update('category', e.target.value)}><NativeSelectOptGroup label="Phạm vi"><NativeSelectOption value="">Tất cả danh mục</NativeSelectOption><NativeSelectOption value="unknown">Chưa có danh mục</NativeSelectOption></NativeSelectOptGroup><NativeSelectOptGroup label="Danh mục YouTube (bản lưu)">{catalog?.categories.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.label || item.title}{item.legacy ? ' (lịch sử)' : ''}</NativeSelectOption>)}</NativeSelectOptGroup></NativeSelect><FieldDescription>Danh mục lưu sẵn, không phải danh sách trực tiếp theo khu vực.</FieldDescription></Field>
          <Field><FieldLabel id="content-label">Loại nội dung</FieldLabel><ToggleGroup type="multiple" variant="outline" value={form.content_types} onValueChange={v => update('content_types', v)} aria-labelledby="content-label" className="content-types"><ToggleGroupItem value="video">Video</ToggleGroupItem><ToggleGroupItem value="shorts">Shorts</ToggleGroupItem><ToggleGroupItem value="livestream">Trực tiếp</ToggleGroupItem></ToggleGroup><FieldDescription>Không chọn: lấy tất cả loại.</FieldDescription></Field>
          <SelectField id="live-status" label="Trạng thái trực tiếp" value={form.live_status} onChange={v => update('live_status', v)} options={[[ '', 'Tất cả'], ['is_live', 'Đang trực tiếp'], ['is_upcoming', 'Sắp phát'], ['was_live', 'Đã trực tiếp'], ['not_live', 'Không trực tiếp'], ['post_live', 'Vừa kết thúc']]} />
          <Field><FieldLabel htmlFor="date-after">Ngày đăng từ</FieldLabel><Input id="date-after" name="date_after" type="date" value={form.date_after} onChange={e => update('date_after', e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="date-before">Ngày đăng đến</FieldLabel><Input id="date-before" name="date_before" type="date" value={form.date_before} onChange={e => update('date_before', e.target.value)} /></Field>
          {form.source_type === 'playlist' && <FieldSet><FieldLegend variant="label">Vị trí trong playlist</FieldLegend><FieldGroup className="range-fields"><Field><FieldLabel htmlFor="playlist-start" className="sr-only">Vị trí bắt đầu</FieldLabel><Input id="playlist-start" name="playlist_start" type="number" min="1" value={form.playlist_start} onChange={e => update('playlist_start', e.target.value)} placeholder="Từ vị trí…" /></Field><span aria-hidden="true">–</span><Field><FieldLabel htmlFor="playlist-end" className="sr-only">Vị trí kết thúc</FieldLabel><Input id="playlist-end" name="playlist_end" type="number" min="1" value={form.playlist_end} onChange={e => update('playlist_end', e.target.value)} placeholder="Đến vị trí…" /></Field></FieldGroup></FieldSet>}
        </FieldGroup>
      </div></details>
      <Dialog open={nativeOpen} onOpenChange={setNativeOpen}><DialogTrigger asChild><Button variant="outline" type="button" disabled={!nativeAllowed}><SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Bộ lọc YouTube{nativeCount > 0 && <Badge variant="secondary">{nativeCount}</Badge>}</Button></DialogTrigger><DialogContent className="native-dialog"><DialogHeader><DialogTitle>Bộ lọc tìm kiếm YouTube</DialogTitle><DialogDescription>Áp dụng trước khi lấy metadata. Một số kết hợp có thể không được YouTube hỗ trợ.</DialogDescription></DialogHeader><FieldGroup className="gap-5">
        <SelectField id="native-type" label="Loại kết quả" value={form.native.result_type} onChange={v => native('result_type', v)} options={[[ 'videos', 'Video & Shorts'], ['longform', 'Video dài'], ['shorts', 'Shorts'], ['channels', 'Kênh'], ['playlists', 'Playlist'], ['movies', 'Phim']]} />
        <SelectField id="native-order" label="Sắp xếp kết quả" value={form.native.order} onChange={v => native('order', v)} options={[[ 'relevance', 'Độ liên quan'], ['popularity', 'Phổ biến']]} />
        <SelectField id="native-upload" label="Thời gian tải lên" value={form.native.upload_date} onChange={v => native('upload_date', v)} options={[[ 'all', 'Bất kỳ lúc nào'], ['today', 'Hôm nay'], ['week', 'Tuần này'], ['month', 'Tháng này'], ['year', 'Năm nay']]} />
        <SelectField id="native-duration" label="Thời lượng YouTube" value={form.native.duration} onChange={v => native('duration', v)} options={[[ 'all', 'Mọi thời lượng'], ['short', 'Dưới 3 phút'], ['medium', '3–20 phút'], ['long', 'Trên 20 phút']]} />
        <FieldSet><FieldLegend variant="label">Tính năng</FieldLegend><ToggleGroup type="multiple" variant="outline" value={form.native.features} onValueChange={v => native('features', v)} className="native-features" aria-label="Tính năng YouTube">{(catalog?.native_features ?? []).map(feature => <ToggleGroupItem key={feature.id} value={feature.id}>{feature.label}</ToggleGroupItem>)}</ToggleGroup></FieldSet>
      </FieldGroup><DialogFooter><Button type="button" variant="outline" onClick={() => setForm(prev => ({ ...prev, native: { ...initialForm.native } }))}>Đặt lại</Button><Button type="button" onClick={() => setNativeOpen(false)}>Áp dụng bộ lọc</Button></DialogFooter></DialogContent></Dialog>
      {!nativeAllowed && <p className="helper-line"><Info aria-hidden="true" /> Bộ lọc YouTube chỉ áp dụng cho từ khóa và URL tìm kiếm.</p>}

      <p className="source-footnote">Chỉ thu thập metadata công khai.<br />Không tải video, âm thanh hay bình luận.</p>
    </form>
  </aside>;
}
