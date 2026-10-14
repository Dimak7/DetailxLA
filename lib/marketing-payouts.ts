export type PayoutRow = {id:string; booking_date:string; completed_at?:string|null; status:string; state:string; basis_cents:number; rate_bps:number; earned_cents:number; paid_cents:number; due_cents:number; can_approve:boolean; collected_cents:number; refunded_cents:number};
export function commissionPaymentStatus(row:PayoutRow) {
  if(row.state === "Adjustment required") return "Adjustment needed";
  if(row.state === "Not eligible" || row.state.startsWith("Repeat customer")) return "Not eligible";
  if(row.paid_cents>0 && row.paid_cents>=row.earned_cents) return "Paid";
  return row.can_approve || row.due_cents>0 ? "Ready for payout" : "Pending";
}
export function payoutWeek(day:string) {
  const date=new Date(day.slice(0,10)+"T12:00:00Z");
  date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
  return date.toISOString().slice(0,10);
}
export function weeklyPayouts(rows:PayoutRow[]) {
  const groups=new Map<string,{week:string;earnings_cents:number;paid_cents:number;ready_cents:number;count:number}>();
  for(const row of rows) {
    if(!row.earned_cents && !row.paid_cents) continue;
    const day=row.completed_at ? new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(row.completed_at)) : row.booking_date;
    const week=payoutWeek(day),group=groups.get(week)||{week,earnings_cents:0,paid_cents:0,ready_cents:0,count:0};
    group.earnings_cents+=row.earned_cents;group.paid_cents+=row.paid_cents;
    group.ready_cents+=Math.max(0,row.earned_cents-row.paid_cents);group.count++;
    groups.set(week,group);
  }
  return [...groups.values()].sort((a,b)=>b.week.localeCompare(a.week));
}
