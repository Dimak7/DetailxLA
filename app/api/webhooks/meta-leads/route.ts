import {after,NextResponse} from "next/server";
import {secret} from "@/lib/platform/settings";
import {AppError} from "@/lib/platform/auth";
import {apiError} from "@/lib/platform/http";
import {verifyMetaSignature,receiveMetaLeads,processMetaLeads} from "@/lib/integrations/meta-leads";
import {processOutbox} from "@/lib/platform/worker";
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,expected=await secret("meta_leads_verify_token");
 if(!expected||params.get("hub.mode")!=="subscribe"||params.get("hub.verify_token")!==expected)return new NextResponse("Forbidden",{status:403});
 return new NextResponse(params.get("hub.challenge")||"",{headers:{"Content-Type":"text/plain"}});
}
export async function POST(request:Request){try{
 const body=await request.text();if(body.length>1000000)throw new AppError("Request too large.",413);
 if(!verifyMetaSignature(body,request.headers.get("x-hub-signature-256")||"",await secret("meta_leads_app_secret")))throw new AppError("Invalid signature.",401);
 await receiveMetaLeads(JSON.parse(body));
 after(async()=>{await processMetaLeads(10).catch(()=>{});await processOutbox(10).catch(()=>{});});
 return NextResponse.json({ok:true});
 }catch(e){return apiError(e);}}
