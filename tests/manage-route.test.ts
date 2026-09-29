import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { workAsyncStorage, type WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import { POST } from "../app/api/manage/route";
import { database, query, closeDatabase, type Query } from "../lib/platform/db";
import { hash } from "../lib/platform/auth";

process.env.PGLITE_PATH = "memory://manage-route";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
process.env.SQUARE_ENVIRONMENT = "sandbox";
process.env.SQUARE_ACCESS_TOKEN = "fake-manage-route-token";

test("manage saves succeed after database context loss and only successful normal actions run the outbox", async (t) => {
  const db = await database();
  const originalQuery = db.query;
  let inRequestScope = false;
  let callbacks: Array<() => Promise<void>> = [];
  const store = { afterContext: { after(callback: () => Promise<void>) { callbacks.push(callback); } } } as unknown as WorkStore;
  t.mock.method(workAsyncStorage,"getStore",() => inRequestScope ? store : undefined);
  const fetches:string[] = [];
  t.mock.method(globalThis,"fetch",async (input:RequestInfo|URL, init?:RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin,"https://connect.squareupsandbox.com");
    assert.equal(init?.method,"GET");
    fetches.push(url.pathname);
    return Response.json(url.pathname === "/v2/locations" ? {locations:[{id:"TEST"}]} : {payments:[]});
  });
  try {
    const manager = randomUUID(), staff = randomUUID(), employee = randomUUID(), message = randomUUID();
    const managerToken = "a".repeat(64), staffToken = "b".repeat(64);
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Manager',$2,'fixture','manager'),($3,'Staff',$4,'fixture','staff')",[manager,`${manager}@example.test`,staff,`${staff}@example.test`]);
    await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day'),($3,$4,now()+interval '1 day')",[hash(managerToken),manager,hash(staffToken),staff]);
    await query("INSERT INTO wl.employees(id,name,position) VALUES($1,'Route employee','Detailer')",[employee]);
    // This stale delivery exercises the worker without sending any message.
    await query("INSERT INTO wl.messages(id,dedupe_key,channel,recipient,body,status,locked_at) VALUES($1::uuid,$1::text,'email','fixture@example.test','Fixture','sending',now()-interval '1 hour')",[message]);
    db.query = (async (sql,params) => {
      // Reproduce an adapter boundary that drops Next's ambient request store.
      inRequestScope = false;
      return originalQuery(sql,params);
    }) as Query;
    const payload = { action:"save_employee_compensation",data:{employee_id:employee,compensation_model:"flat_job",hourly_rate_cents:1000,default_commission_bps:3000,flat_job_pay_cents:6500} };
    const request = (body:unknown = payload, token = managerToken, origin = "https://example.test") => new Request("https://example.test/api/manage", {
      method:"POST",headers:{"Content-Type":"application/json",Origin:origin,...(token ? {Cookie:`wl_session=${token}`} : {})},body:typeof body === "string" ? body : JSON.stringify(body),
    });
    const run = async (input:Request) => {
      callbacks = [];
      inRequestScope = true;
      const response = await POST(input);
      return {response,afterTasks:[...callbacks]};
    };
    const status = async () => (await query<{status:string}>("SELECT status FROM wl.messages WHERE id=$1",[message]))[0].status;
    const saved = await run(request());
    assert.equal(saved.response.status,200);
    assert.equal((await saved.response.json()).ok,true);
    assert.equal(saved.afterTasks.length,1);
    assert.equal((await query<{flat_job_pay_cents:number}>("SELECT flat_job_pay_cents FROM wl.employees WHERE id=$1",[employee]))[0].flat_job_pay_cents,6500);
    assert.equal(await status(),"sending","the worker does not run before the response");
    await saved.afterTasks[0]();
    assert.equal(await status(),"uncertain","successful saves still process the outbox after the response");
    assert.deepEqual(fetches,[]);

    await query("UPDATE wl.messages SET status='sending',locked_at=now()-interval '1 hour' WHERE id=$1",[message]);
    for (const [input,expected] of [
      [request(payload,""),401],
      [request(payload,staffToken),403],
      [request("{broken"),400],
      [request({...payload,data:{...payload.data,flat_job_pay_cents:-1}}),400],
    ] as const) {
      const failed = await run(input);
      assert.equal(failed.response.status,expected);
      assert.equal(failed.afterTasks.length,1);
      for (const task of failed.afterTasks) await task();
      assert.equal(await status(),"sending","failed or unauthorized actions must not process the outbox");
    }
    const forbidden = await run(request(payload,managerToken,"https://other.example"));
    assert.equal(forbidden.response.status,403);
    assert.equal(forbidden.afterTasks.length,0,"origin rejection happens before registering background work");
    assert.equal((await query<{flat_job_pay_cents:number}>("SELECT flat_job_pay_cents FROM wl.employees WHERE id=$1",[employee]))[0].flat_job_pay_cents,6500);

    const sync = await run(request({action:"sync_square_payments",data:{}}));
    assert.equal(sync.response.status,200);
    for (const task of sync.afterTasks) await task();
    assert.equal(await status(),"sending","historical Square sync never sends pending messages");
    assert.deepEqual(fetches,["/v2/locations","/v2/payments"]);
  } finally {
    db.query = originalQuery;
    await closeDatabase();
  }
});
