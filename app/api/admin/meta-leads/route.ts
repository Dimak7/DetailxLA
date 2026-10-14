import {NextResponse,after} from "next/server";
import {z} from "zod";
import {requireSession,assertOrigin} from "@/lib/platform/auth";
import {apiError,readJson} from "@/lib/platform/http";
import {metaLeadsStatus,saveMetaLeadsConfig,metaLeadsConfigSchema,processMetaLeads} from "@/lib/integrations/meta-leads";
import {processOutbox} from "@/lib/platform/worker";
export async function GET(request:Request){try{await requireSession(request,"marketing");const status=await metaLeadsStatus();if(status.config&&status.token_configured)after(async()=>{await processMetaLeads(5).catch(()=>{});await processOutbox(5).catch(()=>{});});return NextResponse.json(status,{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{assertOrigin(request);await requireSession(request,"marketing");const data=z.object({config:metaLeadsConfigSchema,page_token:z.string().trim().max(12000).default(""),app_secret:z.string().trim().max(1000).default("")}).parse(await readJson(request));await saveMetaLeadsConfig(data.config,data.page_token,data.app_secret);return NextResponse.json({ok:true,...await metaLeadsStatus()});}catch(e){return apiError(e);}}
