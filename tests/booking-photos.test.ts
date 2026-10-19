import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import sharp from "sharp";
import { createBooking } from "../lib/platform/bookings";
import { query, closeDatabase } from "../lib/platform/db";
import { hash } from "../lib/platform/auth";
import { POST, GET } from "../app/api/bookings/[id]/photos/route";
import { GET as image } from "../app/api/booking-photos/[id]/route";
import type { Service } from "../lib/platform/types";
Object.assign(process.env,{NODE_ENV:"test",PGLITE_PATH:"memory://booking-photos",ADMIN_EMAIL:"photos-owner@example.test",ADMIN_PASSWORD:"photos-test-long-password",NEXT_PUBLIC_SITE_URL:"https://example.test"});
for(const key of ["DATABASE_URL","RAILWAY_ENVIRONMENT","SQUARE_ACCESS_TOKEN","STRIPE_SECRET_KEY"])delete process.env[key];
test("job photos are persisted privately and restricted to authorized assigned staff", async () => {
 try {
  const service=(await query<Service>("SELECT * FROM wl.services WHERE slug='exterior-detail'"))[0];
  const owner=(await query<{id:string}>("SELECT id FROM wl.users WHERE email=$1",[process.env.ADMIN_EMAIL]))[0];
  const date=new Date(Date.now()+18*86400000);while(date.getUTCDay()===0)date.setUTCDate(date.getUTCDate()+1);
  const {booking:b}=await createBooking({request_key:randomUUID(),session_id:randomUUID(),service_id:service.id,first_name:"Photo",last_name:"Fixture",email:"photo@example.test",phone:"+13125550123",make:"Test",model:"Car",year:2026,vehicle_type:"Sedan",date:date.toISOString().slice(0,10),start_minute:480,terms:true},true);
  async function session(id:string){const token=randomBytes(32).toString("hex");await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[hash(token),id]);return `wl_session=${token}`;}
  const cookie=await session(owner.id),ctx={params:Promise.resolve({id:b.id})};
  const png=await sharp({create:{width:8,height:8,channels:3,background:"blue"}}).png().toBuffer();
  function upload(cookie:string,stage="before",file=new File([new Uint8Array(png)],"car.png",{type:"image/png"})) {const form=new FormData();form.set("file",file);form.set("stage",stage);return POST(new Request("https://example.test/api/bookings/"+b.id+"/photos",{method:"POST",headers:{Cookie:cookie,Origin:"https://example.test"},body:form}),ctx);}
  const response=await upload(cookie);assert.equal(response.status,200);const saved=await response.json();
  const photoCtx={params:Promise.resolve({id:saved.id})};
  assert.equal((await image(new Request("https://example.test/api/booking-photos/"+saved.id),photoCtx)).status,401);
  const bytes=await image(new Request("https://example.test/api/booking-photos/"+saved.id,{headers:{Cookie:cookie}}),photoCtx);
  assert.equal(bytes.status,200);assert.equal(bytes.headers.get("Cache-Control"),"private, no-store");assert.equal(bytes.headers.get("Content-Type"),"image/webp");assert.ok((await bytes.arrayBuffer()).byteLength>0);
  const staff=randomUUID();await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Photo worker','photo-worker@example.test','unused','staff')",[staff]);const staffCookie=await session(staff);
  assert.equal((await upload(staffCookie)).status,404);
  await query("UPDATE wl.bookings SET assigned_to=$2 WHERE id=$1",[b.id,staff]);
  assert.equal((await upload(staffCookie,"after")).status,200);
  const list=await GET(new Request("https://example.test/api/bookings/"+b.id+"/photos",{headers:{Cookie:staffCookie}}),ctx);assert.equal(list.status,200);assert.equal((await list.json()).photos.length,2);
  assert.equal((await upload(cookie,"after",new File(["not an image"],"bad.png",{type:"image/png"}))).status,400);
  await query("UPDATE wl.bookings SET assigned_to=NULL WHERE id=$1",[b.id]);
  assert.equal((await image(new Request("https://example.test/api/booking-photos/"+saved.id,{headers:{Cookie:staffCookie}}),photoCtx)).status,404);
 } finally {await closeDatabase();}
});
