import test from "node:test";
import assert from "node:assert/strict";
import { marketingWebsitePerformance } from "../lib/marketing-performance";
test("comparison assigns paid phone jobs once and keeps unmatched Meta campaign revenue out of scoped ROAS",()=>{
 const campaign=(source:string,lead_stream:string,campaign:string,revenue:number)=>({source,lead_stream,campaign,revenue,bookings:1,leads:0});
 const data=[campaign("Phone","Business Google · 10%","",10000),campaign("Meta Ads","Business Meta · 10%","111111",20000),campaign("Meta Ads","Business Meta · 10%","222222",30000),campaign("Organic","Unassigned","",40000),campaign("Google Ads","Dima Leads","old",50000)];
 const scoped=marketingWebsitePerformance(data,["111111"]);
 assert.equal(scoped.streams["Business Google · 10%"].revenue,10000);
 assert.equal(scoped.other.some((row)=>row.channel==="Phone"),false);
 assert.equal(scoped.streams["Business Meta · 10%"].revenue,20000);
 assert.equal(scoped.other.find((row)=>row.channel==="Meta website · unmatched campaign")?.revenue,30000);
 assert.equal(scoped.other.find((row)=>row.channel==="Organic")?.revenue,40000);
 assert.equal(scoped.other.find((row)=>row.channel==="Google Ads")?.revenue,50000);
 assert.equal([...Object.values(scoped.streams),...scoped.other].reduce((sum,row)=>sum+row.revenue,0),150000);
 assert.equal(marketingWebsitePerformance(data,null).streams["Business Meta · 10%"].revenue,50000);
});
