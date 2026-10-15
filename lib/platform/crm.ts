import {randomUUID} from "node:crypto";
import {z} from "zod";
import {query,transaction,type Query} from "./db";
import {AppError} from "./auth";
import type {Session} from "./types";
export type CrmTag={id:string;name:string;color:string;archived_at:string|null};
export const crmTagInput=z.object({id:z.uuid().optional(),name:z.string().trim().min(1).max(40).transform(s=>s.replace(/\s+/g," ")),color:z.string().regex(/^#[a-fA-F0-9]{6}$/).default("#426b60")});
export async function crmTags(){return query<CrmTag>("SELECT id,name,color,archived_at FROM wl.crm_tags ORDER BY archived_at NULLS FIRST,lower(name)");}
export function recordTagsSql(kind:"lead"|"customer",alias:string){
 const table=kind==="lead"?"lead_tags":"customer_tags",column=kind==="lead"?"lead_id":"customer_id";
 return `COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'color',t.color) ORDER BY t.name) FROM wl.${table} rt JOIN wl.crm_tags t ON t.id=rt.tag_id WHERE rt.${column}=${alias}.id AND t.archived_at IS NULL),'[]'::jsonb) tags`;
}
async function audit(q:Query,actor:string,kind:string,id:string,body:string){await q("INSERT INTO wl.timeline(id,lead_id,customer_id,type,body,actor_id) VALUES($1,$2,$3,'crm_updated',$4,$5)",[randomUUID(),kind==="lead"?id:null,kind==="customer"?id:null,body,actor]);}
async function ensureTag(q:Query,name:string,color:string){
 return (await q<{id:string}>("INSERT INTO wl.crm_tags(id,name,color) VALUES($1,$2,$3) ON CONFLICT(name) DO UPDATE SET archived_at=NULL RETURNING id",[randomUUID(),name,color])).rows[0].id;
}
export async function crmAction(action:string,input:unknown,user:Session){
 if(action==="save_crm_tag"){
  const tag=crmTagInput.parse(input);
  return transaction(async q=>{
   await q("SELECT id FROM wl.schedule_guard WHERE id=1 FOR UPDATE");
   const duplicate=(await q("SELECT id FROM wl.crm_tags WHERE lower(name)=lower($1) AND ($2::uuid IS NULL OR id<>$2)",[tag.name,tag.id||null])).rows;
   if(duplicate.length)throw new AppError("A tag with this name already exists. Restore it if archived.");
   if(tag.id){const updated=await q("UPDATE wl.crm_tags SET name=$2,color=$3 WHERE id=$1 RETURNING id",[tag.id,tag.name,tag.color]);if(!updated.rows.length)throw new AppError("Tag not found.",404);}
   else await q("INSERT INTO wl.crm_tags(id,name,color) VALUES($1,$2,$3)",[randomUUID(),tag.name,tag.color]);
  });
 }
 if(action==="archive_crm_tag"||action==="restore_crm_tag"){
  const {id}=z.object({id:z.uuid()}).parse(input);
  await query("UPDATE wl.crm_tags SET archived_at="+(action==="archive_crm_tag"?"now()":"NULL")+" WHERE id=$1",[id]);return;
 }
 if(action==="tag_lead"||action==="tag_customer"){
  const {id,tag_id,operation}=z.object({id:z.uuid(),tag_id:z.uuid(),operation:z.enum(["add","remove"])}).parse(input);
  const kind=action==="tag_lead"?"lead":"customer",table=kind==="lead"?"lead_tags":"customer_tags",column=kind==="lead"?"lead_id":"customer_id",record=kind==="lead"?"leads":"customers";
  return transaction(async q=>{
   if(!(await q(`SELECT id FROM wl.${record} WHERE id=$1 FOR UPDATE`,[id])).rows.length)throw new AppError("CRM record not found.",404);
   const tag=(await q<CrmTag>("SELECT * FROM wl.crm_tags WHERE id=$1 AND archived_at IS NULL",[tag_id])).rows[0];if(!tag)throw new AppError("Choose an active tag.");
   const result=operation==="add"?await q(`INSERT INTO wl.${table}(${column},tag_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING tag_id`,[id,tag_id,user.user_id]):await q(`DELETE FROM wl.${table} WHERE ${column}=$1 AND tag_id=$2 RETURNING tag_id`,[id,tag_id]);
   if(result.rows.length)await audit(q,user.user_id,kind,id,`${operation==="add"?"Added":"Removed"} tag: ${tag.name}`);
  });
 }
 if(action==="lead_outcome"){
  const {id,outcome}=z.object({id:z.uuid(),outcome:z.enum(["call_again","contacted","sold","lost"])}).parse(input);
  return transaction(async q=>{
   if(!(await q("SELECT id FROM wl.leads WHERE id=$1 FOR UPDATE",[id])).rows.length)throw new AppError("Lead not found.",404);
   await q("DELETE FROM wl.lead_tags WHERE lead_id=$1 AND tag_id IN (SELECT id FROM wl.crm_tags WHERE name IN ('Call again','No answer','Sold','Not interested'))",[id]);
   const names=outcome==="call_again"?["No answer","Call again"]:outcome==="sold"?["Sold"]:outcome==="lost"?["Not interested"]:[];
   for(const name of names){const tag=await ensureTag(q,name,outcome==="sold"?"#28715d":outcome==="lost"?"#8f514a":"#926824");await q("INSERT INTO wl.lead_tags(lead_id,tag_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[id,tag,user.user_id]);}
   // An unanswered call does not establish contact or reserve an appointment.
   await q("UPDATE wl.leads SET status=CASE WHEN $2='call_again' THEN CASE WHEN status IN ('won','lost') THEN 'new' ELSE status END ELSE $3 END,call_customer=$4,updated_at=now() WHERE id=$1",[id,outcome,outcome==="sold"?"won":outcome==="lost"?"lost":"contacted",outcome==="call_again"]);
   await audit(q,user.user_id,"lead",id,{call_again:"No answer · call again",contacted:"Customer contacted",sold:"Lead sold",lost:"Not interested"}[outcome]);
  });
 }
}
