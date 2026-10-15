"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {Modal,action} from "./AdminControls";
export function RemoveTeamMember({id,name,removed}:{id:string;name:string;removed:boolean}){
 const router=useRouter(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function save(){setBusy(true);setError("");try{await action(removed?"restore_user":"remove_user",{id});setOpen(false);router.refresh();}catch(e){setError(e instanceof Error?e.message:"Could not update team access.");}finally{setBusy(false);}}
 return <><button type="button" disabled={busy} onClick={()=>setOpen(true)}>{removed?"Restore":"Remove from team"}</button>{open&&<Modal title={removed?`Restore ${name}?`:`Remove ${name} from the team?`} onClose={()=>setOpen(false)}><p>{removed?"This restores their team record with login access still disabled. Use Edit access to reactivate them when ready.":"Their login and current sessions will be revoked immediately, and their employee profile will become inactive. They will be removed from the active team list."}</p>{!removed&&<p>Bookings, payroll, time entries and work history stay available. Review any assigned upcoming jobs and shifts before reassigning them. You can restore this person later.</p>}{error&&<p role="alert">{error}</p>}<div className="button-row"><button className="button" disabled={busy} onClick={()=>void save()}>{busy?"Saving…":removed?"Restore record":"Remove & revoke access"}</button><button type="button" onClick={()=>setOpen(false)}>Cancel</button></div></Modal>}</>;
}
