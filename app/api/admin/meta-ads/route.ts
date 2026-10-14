import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
import { reportRange } from "@/lib/platform/reporting";
import { metaAdsConfigSchema, metaAdsReportStatus, saveMetaAdsConfig, syncMetaAdsReport } from "@/lib/integrations/meta-ads-reporting";
export async function GET(request:Request){
  try{
    await requireSession(request,"marketing");
    const range=reportRange(new URL(request.url).searchParams),status=await metaAdsReportStatus(range.start,range.end);
    const lastAttempt=status.report?.attempted_at ? new Date(status.report.attempted_at).getTime():0;
    if(status.config&&status.token_configured&&Date.now()-lastAttempt>15*60000)after(()=>syncMetaAdsReport(range.start,range.end).catch(()=>{}));
    return NextResponse.json({...status,range},{headers:{"Cache-Control":"no-store"}});
  }catch(e){return apiError(e);}
}
export async function POST(request:Request){
  try{
    const user=await requireSession(request,"marketing");
    const data=z.discriminatedUnion("action",[
      z.object({action:z.literal("configure"),config:metaAdsConfigSchema,token:z.string().trim().max(12000).default("")}),
      z.object({action:z.literal("sync")}),
    ]).parse(await readJson(request));
    const range=reportRange(new URL(request.url).searchParams);
    if(data.action==="configure")await saveMetaAdsConfig(data.config,data.token,user.user_id);
    await syncMetaAdsReport(range.start,range.end);
    return NextResponse.json({ok:true,...await metaAdsReportStatus(range.start,range.end),range});
  }catch(e){return apiError(e);}
}
