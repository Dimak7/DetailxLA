import { marketingStreams } from "./marketing-streams";
type Campaign={source:string;lead_stream:string;campaign:string;leads:number;bookings:number;revenue:number};
type Totals={leads:number;bookings:number;revenue:number};
export function marketingWebsitePerformance(campaigns:Campaign[],metaCampaignIds:string[]|null){
  const streams:Record<string,Totals>=Object.fromEntries(marketingStreams.map((stream)=>[stream.name,{leads:0,bookings:0,revenue:0}]));
  const other=new Map<string,Totals>();
  for(const row of campaigns){
    const unmatchedMeta=row.lead_stream==="Business Meta · 10%"&&metaCampaignIds&&!metaCampaignIds.includes(row.campaign);
    const stream=Object.hasOwn(streams,row.lead_stream)?streams[row.lead_stream]:undefined;
    const key=unmatchedMeta?"Meta website · unmatched campaign":row.source;
    const total=stream&&!unmatchedMeta?stream:other.get(key)||{leads:0,bookings:0,revenue:0};
    total.leads+=row.leads;total.bookings+=row.bookings;total.revenue+=row.revenue;
    if(!stream||unmatchedMeta)other.set(key,total);
  }
  return {streams,other:[...other].map(([channel,totals])=>({channel,...totals}))};
}
