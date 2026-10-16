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
    if (next.from && next.to && next.from > next.to) { setError('Ngày bắt đầu không được sau ngày kết thúc.'); return; }
    onChange(next);
  }
  return <form className="history-filters" aria-label="Lọc lịch sử theo thời gian" onSubmit={event=>{event.preventDefault();apply(range);}}>
    <ToggleGroup type="single" variant="outline" value={active} onValueChange={value=>value && apply(presets[value])} aria-label="Khoảng thời gian nhanh" className="history-presets">
      {Object.entries({all:'Tất cả',today:'Hôm nay',week:'7 ngày qua',month:'Tháng này',previous:'Tháng trước'}).map(([value,label])=><ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
    </ToggleGroup>
    <FieldGroup className="history-date-fields">
      <Field><FieldLabel htmlFor="history-month">Chọn tháng</FieldLabel><Input id="history-month" name="history_month" type="month" value={month && month.from===range.from && month.to===range.to ? range.from.slice(0,7) : ''} onChange={event=>{const next=monthRange(event.target.value);if(next)setRange(next);}} /></Field>
      <Field><FieldLabel htmlFor="history-from">Từ ngày</FieldLabel><Input id="history-from" name="history_from" type="date" value={range.from} onChange={event=>setRange({...range,from:event.target.value})} /></Field>
      <Field><FieldLabel htmlFor="history-to">Đến ngày</FieldLabel><Input id="history-to" name="history_to" type="date" value={range.to} onChange={event=>setRange({...range,to:event.target.value})} /></Field>
      <div className="history-filter-actions"><Button type="submit">Áp dụng</Button><Button type="button" variant="ghost" onClick={()=>apply({from:'',to:''})} disabled={!range.from && !range.to && !from && !to}>Xóa bộ lọc</Button></div>
    </FieldGroup>
    <p className="helper-line">Chọn tháng hoặc nhập khoảng ngày rồi bấm Áp dụng. Lọc theo ngày tạo lượt thu thập, theo giờ địa phương.</p>
    {error && <Alert variant="destructive"><AlertTitle>Khoảng ngày chưa hợp lệ</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
  </form>;
}
