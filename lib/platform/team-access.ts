import {randomUUID} from "node:crypto";
import {z} from "zod";
import {transaction} from "./db";
import {AppError} from "./auth";
import type {Session} from "./types";
export async function removeTeamAccess(input:unknown,user:Session,restore=false){
 const {id}=z.object({id:z.uuid()}).parse(input);
 if(!["owner","admin"].includes(user.role))throw new AppError("You cannot manage team access.",403);
 if(id===user.user_id)throw new AppError("You cannot remove your own account.",403);
 return transaction(async q=>{
  const person=(await q<{role:string;name:string}>("SELECT role,name FROM wl.users WHERE id=$1 FOR UPDATE",[id])).rows[0];
  if(!person)throw new AppError("Team member not found.",404);
  if(person.role==="owner"&&user.role!=="owner")throw new AppError("Only an owner can change another owner.",403);
  await q("UPDATE wl.users SET active=false,removed_at="+(restore?"NULL":"now()")+",updated_at=now() WHERE id=$1",[id]);
  await q("UPDATE wl.employees SET active=false,updated_at=now() WHERE user_id=$1",[id]);
  await q("DELETE FROM wl.sessions WHERE user_id=$1",[id]);
  await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,after_data) VALUES($1,$2,'user',$3,$4,$5::jsonb)",[randomUUID(),user.user_id,id,restore?"restored":"removed",JSON.stringify({name:person.name,active:false})]);
  return {id};
 });
}
