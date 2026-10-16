'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { historyPresets, monthRange, type HistoryRange } from '@/lib/history';

export function HistoryFilters({ from, to, onChange }: HistoryRange & {onChange:(range:HistoryRange)=>void}) {
  const [range,setRange] = useState({from,to});
  const [error,setError] = useState('');
  const presets = historyPresets();
  const active = Object.keys(presets).find(key=>presets[key].from===range.from && presets[key].to===range.to) || '';
  const month = range.from && monthRange(range.from.slice(0,7));
  function apply(next: HistoryRange) {
    setError(''); setRange(next);
    if (next.from && next.to && next.from > next.to) { setError('The start date must not be after the end date.'); return; }
    onChange(next);
  }
  return <form className="history-filters" aria-label="Filter history by date" onSubmit={event=>{event.preventDefault();apply(range);}}>
    <ToggleGroup type="single" variant="outline" value={active} onValueChange={value=>value && apply(presets[value])} aria-label="Date presets" className="history-presets">
      {Object.entries({all:'All',today:'Today',week:'Last 7 days',month:'This month',previous:'Last month'}).map(([value,label])=><ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
    </ToggleGroup>
    <FieldGroup className="history-date-fields">
      <Field><FieldLabel htmlFor="history-month">Choose month</FieldLabel><Input id="history-month" name="history_month" type="month" value={month && month.from===range.from && month.to===range.to ? range.from.slice(0,7) : ''} onChange={event=>{const next=monthRange(event.target.value);if(next)setRange(next);}} /></Field>
      <Field><FieldLabel htmlFor="history-from">From date</FieldLabel><Input id="history-from" name="history_from" type="date" value={range.from} onChange={event=>setRange({...range,from:event.target.value})} /></Field>
      <Field><FieldLabel htmlFor="history-to">To date</FieldLabel><Input id="history-to" name="history_to" type="date" value={range.to} onChange={event=>setRange({...range,to:event.target.value})} /></Field>
      <div className="history-filter-actions"><Button type="submit">Apply</Button><Button type="button" variant="ghost" onClick={()=>apply({from:'',to:''})} disabled={!range.from && !range.to && !from && !to}>Clear filters</Button></div>
    </FieldGroup>
    <p className="helper-line">Choose a month or enter a date range, then select Apply. Filters use the collection creation date in your local time zone.</p>
    {error && <Alert variant="destructive"><AlertTitle>Invalid date range</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
  </form>;
}
