export type HistoryRange = { from: string; to: string };
function localDate(value: Date): string {
  return `${String(value.getFullYear()).padStart(4,'0')}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
}
export function monthRange(month: string): HistoryRange | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) return null;
  const [year,number] = month.split('-').map(Number);
  const last = new Date(0); last.setFullYear(year,number,0);
  return {from:`${month}-01`,to:`${month}-${String(last.getDate()).padStart(2,'0')}`};
}
export function historyPresets(now = new Date()): Record<string, HistoryRange> {
  const today = localDate(now);
  const week = new Date(now); week.setDate(week.getDate()-6);
  const previous = new Date(now); previous.setDate(1); previous.setMonth(previous.getMonth()-1);
  return { all:{from:'',to:''}, today:{from:today,to:today}, week:{from:localDate(week),to:today},
    month:monthRange(today.slice(0,7))!, previous:monthRange(localDate(previous).slice(0,7))! };
}
export function groupHistoryByDay<T extends { created_at: string }>(items: T[], timeZone: string): {key:string;items:T[]}[] {
  const formatter = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  const groups = new Map<string,T[]>();
  for (const item of items) {
    const parts = formatter.formatToParts(new Date(item.created_at));
    const key = ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key)!.push(item);
  }
  return Array.from(groups,([key,items])=>({key,items}));
}
