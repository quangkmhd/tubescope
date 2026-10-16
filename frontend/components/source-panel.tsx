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
import { crawlPayload, post, keywordInput, searchOptions, searchTargets } from '@/lib/api';
import { normalizeSourceForm } from '@/lib/source-input';

const sourceLabels: Record<SourceType, string> = { keyword: 'Keywords', channel: 'Channel', playlist: 'Playlist', video: 'Video', search: 'Search URL' };
const placeholders: Record<SourceType, string> = {
  keyword: 'For example: small space design\nsustainable architecture…', channel: 'jazz music\nhttps://www.youtube.com/@channelname…',
  playlist: 'jazz music\nhttps://www.youtube.com/playlist?list=…', video: 'jazz music\nhttps://www.youtube.com/watch?v=…', search: 'https://www.youtube.com/results?search_query=…',
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
  const update = <K extends keyof CrawlForm>(key: K, value: CrawlForm[K]) => {
    if (key === 'sources' || key === 'source_type') setError('');
    setForm(prev => {
      const next = { ...prev, [key]: value, ...(key === 'source_type' && value !== 'channel' ? { content_types: [] } : {}), ...(key === 'source_type' && value !== 'playlist' ? { playlist_start: '', playlist_end: '' } : {}), ...(['duration_min','duration_max'].includes(key) ? { duration_preset: 'custom' } : {}) };
      return key === 'sources' ? normalizeSourceForm(next) : next;
    });
  };
  const native = (key: keyof CrawlForm['native'], value: string | string[]) => setForm(prev => ({ ...prev, native: { ...prev.native, [key]: value } }));
  const inputs = form.sources.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const hasDirectInput = inputs.length === 0 || inputs.some(value => !keywordInput(value));
  const nativeAllowed = ['keyword', 'search'].includes(form.source_type) || !!searchTargets[form.source_type] && (inputs.length === 0 || inputs.some(keywordInput));
  const effectiveNative = searchOptions(form);
  const resourceSearch = ['channels','playlists'].includes(effectiveNative.result_type);
  const resourcesOnly = resourceSearch && !(searchTargets[form.source_type] && hasDirectInput);
  const inputLabel = searchTargets[form.source_type] ? `Keywords or ${form.source_type === 'video' ? 'video' : form.source_type === 'channel' ? 'channel' : 'playlist'} URL` : sourceLabels[form.source_type];
  const nativeCount = (!searchTargets[form.source_type] && effectiveNative.result_type !== 'videos' ? 1 : 0) + (effectiveNative.order !== 'relevance' ? 1 : 0) + (effectiveNative.upload_date !== 'all' ? 1 : 0) + (effectiveNative.duration !== 'all' ? 1 : 0) + effectiveNative.features.length;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try {
      const body = crawlPayload(form);
      setForm(prev => normalizeSourceForm(prev));
      setBusy(true);
      onJob(await post<Job>('/api/jobs', body));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the collection.');
      document.getElementById('sources')?.focus();
    } finally { setBusy(false); }
  }
  return <aside className="source-panel surface" aria-labelledby="source-heading">
    <div className="panel-heading"><div className="heading-icon"><Search aria-hidden="true" /></div><div><h2 id="source-heading">Collection sources</h2><p>Choose sources to add to your library.</p></div></div>
    <p className="optional-legend"><span className="required">*</span> Required · All other fields are optional</p>
    <form onSubmit={submit} onInvalidCapture={event => { const disclosure = (event.target as HTMLElement).closest("details"); if (disclosure) disclosure.open = true; }} className="flex flex-col gap-6">
      <FieldGroup className="gap-5">
        <SelectField id="source-type" label="Source type" value={form.source_type} onChange={v => update('source_type', v as SourceType)} options={Object.entries(sourceLabels) as [string,string][]} />
        <Field data-invalid={!!error}><FieldLabel htmlFor="sources">{inputLabel} <span className="required">*</span></FieldLabel><Textarea id="sources" name="sources" required aria-describedby="source-input-help" aria-invalid={!!error} value={form.sources} onChange={e => update('sources', e.target.value)} placeholder={placeholders[form.source_type]} rows={4} spellCheck={false} autoComplete="off" /><FieldDescription id="source-input-help">{searchTargets[form.source_type] ? `Enter keywords to find ${sourceLabels[form.source_type].toLowerCase()}, or a URL to collect metadata from that source. ` : ''}One source per line, up to 20 sources.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="source-limit">Results per source</FieldLabel><NativeSelect id="source-limit" name="limit" value={customLimit ? "custom" : form.limit} onChange={e => { setCustomLimit(e.target.value === "custom"); update('limit', e.target.value === "custom" ? "" : e.target.value); }}><NativeSelectOptGroup label="Videos per source">{[25,50,100,200,500,1000].map(n => <NativeSelectOption key={n} value={String(n)}>{n} results</NativeSelectOption>)}<NativeSelectOption value="custom">Custom limit</NativeSelectOption></NativeSelectOptGroup></NativeSelect>{customLimit && <Input aria-label="Custom limit" name="custom_limit" type="number" min={1} max={1000} step={1} value={form.limit} onChange={e => update('limit', e.target.value)} placeholder="Default: 100…" />}<FieldDescription>Up to 1,000 results per source, counted before filtering.</FieldDescription></Field>
        <Field><FieldLabel id="mode-label">Metadata mode</FieldLabel><ToggleGroup type="single" value={form.mode} onValueChange={v => v && update('mode', v as 'full'|'quick')} aria-labelledby="mode-label" variant="outline" className="segmented"><ToggleGroupItem value="full">Full</ToggleGroupItem><ToggleGroupItem value="quick">Quick</ToggleGroupItem></ToggleGroup><FieldDescription>{resourcesOnly ? 'Find channel or playlist details without collecting their videos.' : form.mode === 'full' ? 'Collect all 17 metadata groups for your library.' : 'Collect Quick metadata. Full metadata is collected when you save.'}</FieldDescription></Field>

      </FieldGroup>
      {error && <Alert variant="destructive"><AlertTitle>Could not start</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      <Button type="submit" disabled={busy} className="start-button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" data-icon="inline-start" /> : <Play aria-hidden="true" data-icon="inline-start" />}{busy ? 'Starting…' : resourcesOnly ? effectiveNative.result_type === 'channels' ? 'Find channels' : 'Find playlists' : 'Collect metadata'}</Button>
      {!resourcesOnly && <section className="source-prefilters filter-section" aria-labelledby="prefilter-heading">
        <h3 id="prefilter-heading"><ListFilter aria-hidden="true" />Filter before collecting metadata</h3>
        <p>Check duration and views from YouTube listings when available to skip videos that do not match before collecting Full metadata.</p>
        <FieldGroup className="gap-5">
          <SelectField id="duration-preset" label="Duration preset" value={form.duration_preset} onChange={v => { const range = v === 'short' ? ['', '3'] : v === 'medium' ? ['3', '20'] : v === 'long' ? ['20',''] : ['','']; setForm(prev => ({ ...prev, duration_preset: v, duration_min: range[0], duration_max: range[1] })); }} options={[[ 'all', 'Any duration'], ['short', 'Under 3 minutes'], ['medium', '3–20 minutes'], ['long', 'Over 20 minutes'], ['custom', 'Custom range below']]} />
          <FieldSet><FieldLegend variant="label">Duration (minutes)</FieldLegend><FieldGroup className="range-fields"><Field><FieldLabel htmlFor="duration-min" className="sr-only">Minimum duration (minutes)</FieldLabel><Input id="duration-min" name="duration_min" type="number" min="0" step="0.1" value={form.duration_min} onChange={e => update('duration_min', e.target.value)} placeholder="From…" /></Field><span aria-hidden="true">–</span><Field><FieldLabel htmlFor="duration-max" className="sr-only">Maximum duration (minutes)</FieldLabel><Input id="duration-max" name="duration_max" type="number" min="0" step="0.1" value={form.duration_max} onChange={e => update('duration_max', e.target.value)} placeholder="To…" /></Field></FieldGroup></FieldSet>
          <SelectField id="views-preset" label="Minimum views preset" value={form.views_min || 'all'} onChange={v => update('views_min', v === 'all' ? '' : v)} options={[[ 'all', 'Any view count'], ['1000', 'At least 1,000'], ['10000', 'At least 10,000'], ['100000', 'At least 100,000'], ['1000000', 'At least 1,000,000'], ...(!['','1000','10000','100000','1000000'].includes(form.views_min) ? [[form.views_min, 'Custom']] as [string,string][] : [])]} />
          <FieldSet><FieldLegend variant="label">Views</FieldLegend><FieldGroup className="range-fields"><Field><FieldLabel htmlFor="views-min" className="sr-only">Minimum views</FieldLabel><Input id="views-min" name="views_min" type="number" min="0" value={form.views_min} onChange={e => update('views_min', e.target.value)} placeholder="From…" /></Field><span aria-hidden="true">–</span><Field><FieldLabel htmlFor="views-max" className="sr-only">Maximum views</FieldLabel><Input id="views-max" name="views_max" type="number" min="0" value={form.views_max} onChange={e => update('views_max', e.target.value)} placeholder="To…" /></Field></FieldGroup></FieldSet>
        </FieldGroup>
      </section>}
      <details className="advanced-filters"><summary><span>Source settings</span></summary><div className="filter-section"><FieldGroup className="gap-5">
        <Field><FieldLabel id="existing-label">Videos already in library</FieldLabel><ToggleGroup type="single" value={form.existing_policy} onValueChange={v => v && update('existing_policy', v as 'skip'|'update')} aria-labelledby="existing-label" variant="outline" className="segmented"><ToggleGroupItem value="skip">Skip</ToggleGroupItem><ToggleGroupItem value="update">Update</ToggleGroupItem></ToggleGroup><FieldDescription>Your review status and notes are preserved.</FieldDescription></Field>
          {form.source_type === 'channel' && hasDirectInput && <Field><FieldLabel id="content-label">Channel content tabs</FieldLabel><ToggleGroup type="multiple" variant="outline" value={form.content_types} onValueChange={v => update('content_types', v)} aria-labelledby="content-label" className="content-types"><ToggleGroupItem value="video">Videos</ToggleGroupItem><ToggleGroupItem value="shorts">Shorts</ToggleGroupItem><ToggleGroupItem value="livestream">Live</ToggleGroupItem></ToggleGroup><FieldDescription>Leave all unselected to collect from every channel tab. Use the video type filter in results to filter collected content.</FieldDescription></Field>}
          {form.source_type === 'playlist' && hasDirectInput && <FieldSet><FieldLegend variant="label">Playlist positions</FieldLegend><FieldGroup className="range-fields"><Field><FieldLabel htmlFor="playlist-start" className="sr-only">Start position</FieldLabel><Input id="playlist-start" name="playlist_start" type="number" min="1" value={form.playlist_start} onChange={e => update('playlist_start', e.target.value)} placeholder="From position…" /></Field><span aria-hidden="true">–</span><Field><FieldLabel htmlFor="playlist-end" className="sr-only">End position</FieldLabel><Input id="playlist-end" name="playlist_end" type="number" min="1" value={form.playlist_end} onChange={e => update('playlist_end', e.target.value)} placeholder="To position…" /></Field></FieldGroup></FieldSet>}
      </FieldGroup></div></details>
      <section className="native-search-section filter-section" aria-labelledby="native-section-heading"><h3 id="native-section-heading">YouTube search</h3><p>YouTube filters results by upload date, duration, and features before returning them. These filters apply only to keywords and search URLs.</p>
      <Dialog open={nativeOpen} onOpenChange={setNativeOpen}><DialogTrigger asChild><Button variant="outline" type="button" disabled={!nativeAllowed}><SlidersHorizontal aria-hidden="true" data-icon="inline-start" />YouTube filters{nativeCount > 0 && <Badge variant="secondary">{nativeCount}</Badge>}</Button></DialogTrigger><DialogContent className="native-dialog"><DialogHeader><DialogTitle>YouTube search filters</DialogTitle><DialogDescription>Applies to keyword lines and search URLs. Video, channel, and playlist URLs still collect metadata directly from the source.</DialogDescription></DialogHeader><FieldGroup className="gap-5">
        <SelectField id="native-type" label="Result type" value={effectiveNative.result_type} disabled={!!searchTargets[form.source_type]} onChange={v => native('result_type', v)} options={[[ 'videos', 'Videos & Shorts'], ['longform', 'Long-form videos'], ['shorts', 'Shorts'], ['channels', 'Channels'], ['playlists', 'Playlists'], ['movies', 'Movies']]} />
        <SelectField id="native-order" label="Prioritize" value={form.native.order} onChange={v => native('order', v)} options={[[ 'relevance', 'Relevance'], ['popularity', 'Popularity']]} />
        {!resourceSearch && <><SelectField id="native-upload" label="Upload date" value={form.native.upload_date} onChange={v => native('upload_date', v)} options={[[ 'all', 'Any time'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year']]} />
        <SelectField id="native-duration" label="YouTube duration" value={form.native.duration} onChange={v => native('duration', v)} options={[[ 'all', 'Any duration'], ['short', 'Under 3 minutes'], ['medium', '3–20 minutes'], ['long', 'Over 20 minutes']]} />
        <FieldSet><FieldLegend variant="label">Features</FieldLegend><ToggleGroup type="multiple" variant="outline" value={form.native.features} onValueChange={v => native('features', v)} className="native-features" aria-label="YouTube features">{(catalog?.native_features ?? []).map(feature => <ToggleGroupItem key={feature.id} value={feature.id}>{feature.label}</ToggleGroupItem>)}</ToggleGroup></FieldSet></>}
        {resourceSearch && <p className="helper-line">Search for channels or playlists. Video duration, upload date, and feature filters do not apply here.</p>}
      </FieldGroup><DialogFooter><Button type="button" variant="outline" onClick={() => setForm(prev => ({ ...prev, native: { ...initialForm.native } }))}>Reset</Button><Button type="button" onClick={() => setNativeOpen(false)}>Apply filters</Button></DialogFooter></DialogContent></Dialog>
      {!nativeAllowed && <p className="helper-line"><Info aria-hidden="true" /> Enter keywords in the source field or use a search URL to enable these filters.</p>}</section>

      <p className="source-footnote">Only public metadata is collected.<br />Videos, audio, and comments are not downloaded.</p>
    </form>
  </aside>;
}
