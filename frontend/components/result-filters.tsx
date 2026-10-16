'use client';

import { useRef, useState } from 'react';
import { ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { emptyResultFilters, ResultFilterError, serializeResultFilters, type ResultFilterDraft } from '@/lib/result-filters';
import type { Catalog } from '@/lib/types';

type Props = { value: ResultFilterDraft; timeZone: string; catalog?: Catalog; onApply: (values: Record<string, string | null>) => void; onReset: () => void };
function FilterSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select value={value} onValueChange={onChange}><SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger><SelectContent position="popper"><SelectGroup><SelectLabel>{label}</SelectLabel>{options.map(([key, text]) => <SelectItem value={key} key={key}>{text}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
}
export function ResultFilters({ value, timeZone, catalog, onApply, onReset }: Props) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<ResultFilterError | null>(null);
  const valueKey = JSON.stringify(value);
  const [previousValue, setPreviousValue] = useState(valueKey);
  if (valueKey !== previousValue) {
    setPreviousValue(valueKey);
    setDraft(value);
    setError(null);
  }
  const errorRef = useRef<HTMLDivElement>(null);
  const activeCount = Object.entries(value).filter(([key, val]) => val !== emptyResultFilters[key as keyof ResultFilterDraft]).length;
  const update = (key: keyof ResultFilterDraft, value: string) => setDraft(prev => ({ ...prev, [key]: value }));
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    try { onApply(serializeResultFilters(draft, timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')); }
    catch (err) {
      if (err instanceof ResultFilterError) { setError(err); requestAnimationFrame(() => errorRef.current?.focus()); }
      else throw err;
    }
  }
  function range(prefix: 'duration' | 'views' | 'likes' | 'uploaded' | 'saved', label: string, date = false) {
    const keys = date ? [`${prefix}_from`, `${prefix}_to`] : [`${prefix}_min`, `${prefix}_max`];
    return <FieldSet><FieldLegend variant="label">{label}</FieldLegend><FieldGroup className="range-fields">{keys.map((rawKey, index) => {
      const key = rawKey as keyof ResultFilterDraft;
      return <Field key={key} data-invalid={error?.field === key}><FieldLabel htmlFor={`result-${key}`} className="sr-only">{label} {index ? 'to' : 'from'}</FieldLabel><Input id={`result-${key}`} name={key} type={date ? 'date' : 'number'} min={date ? undefined : 0} step={prefix === 'duration' ? 'any' : date ? undefined : '1'} value={draft[key]} onChange={event => update(key, event.target.value)} placeholder={index ? 'To…' : 'From…'} aria-invalid={error?.field === key} aria-describedby={error?.field === key ? 'result-filter-error' : undefined} /></Field>;
    })}</FieldGroup></FieldSet>;
  }
  return <details className="result-filters advanced-filters"><summary><span><ListFilter aria-hidden="true" />Filter collected results{activeCount > 0 && <Badge variant="secondary">{activeCount}</Badge>}</span></summary><p className="result-filter-description">Filter the displayed results across the current collection or library. This does not start a new collection. CSV exports use the same filters.</p><form onSubmit={submit} className="result-filter-form">
    {error && <Alert variant="destructive" ref={errorRef} tabIndex={-1}><AlertTitle>Check filters</AlertTitle><AlertDescription><a id="result-filter-error" href={`#result-${error.field}`}>{error.message}</a></AlertDescription></Alert>}
    <FieldGroup className="result-filter-grid">
      {range('duration', 'Duration (minutes)')}{range('views', 'Views')}{range('likes', 'Likes')}
      <Field><FieldLabel htmlFor="result-category">Category</FieldLabel><Select value={draft.category} onValueChange={value => update('category', value)}><SelectTrigger id="result-category" className="w-full" aria-describedby="result-category-description"><SelectValue /></SelectTrigger><SelectContent position="popper" align="start" className="w-(--radix-select-trigger-width)" style={{ maxHeight: 'min(20rem, var(--radix-select-content-available-height))' }}><SelectGroup><SelectLabel>Scope</SelectLabel><SelectItem value="all">All categories</SelectItem><SelectItem value="unknown">Unknown category</SelectItem></SelectGroup><SelectGroup><SelectLabel>YouTube categories (saved metadata)</SelectLabel>{catalog?.categories.map(item => <SelectItem value={item.id} key={item.id}>{item.label || item.title}{item.legacy ? ' (legacy)' : ''}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription id="result-category-description">Based on categories in the collected metadata.</FieldDescription></Field>
      <FilterSelect id="result-live_status" label="Live status" value={draft.live_status} onChange={value => update('live_status', value)} options={[[ 'all', 'All statuses'], ['is_live', 'Live now'], ['is_upcoming', 'Upcoming'], ['was_live', 'Was live'], ['not_live', 'Not live'], ['post_live', 'Recently ended']]} />
      <FilterSelect id="result-metadata_level" label="Metadata level" value={draft.metadata_level} onChange={value => update('metadata_level', value)} options={[[ 'all', 'All metadata levels'], ['quick', 'Quick'], ['full', 'Full']]} />
      {range('uploaded', 'Upload date', true)}{range('saved', 'Saved date', true)}
    </FieldGroup><p className="helper-line">Saved dates use {timeZone || 'your device time zone'}, including both start and end dates. Unsaved videos have no saved date.</p><div className="result-filter-actions"><Button type="submit">Apply filters</Button><Button variant="outline" type="button" onClick={() => { setDraft({ ...emptyResultFilters }); setError(null); onReset(); }}>Reset filters</Button></div>
  </form></details>;
}
