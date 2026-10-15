import test from 'node:test';
import assert from 'node:assert/strict';
import {query,transaction,closeDatabase} from '../lib/platform/db';
import {upsertSquarePayment,connectSquareAccount,squareRevenueStatus} from '../lib/integrations/square-reporting';
import {adminData} from '../lib/platform/admin';
process.env.PGLITE_PATH='memory://account-switch';delete process.env.DATABASE_URL;
process.env.SQUARE_ENVIRONMENT='production';process.env.SQUARE_ACCESS_TOKEN='new-account-token';
test('switching accounts archives old Square history without mixing current revenue or sync cursors',async()=>{
 const fetchOriginal=globalThis.fetch;
 try{
  for(const [id,location,amount] of [['old-payment','old-location',20000],['new-payment','new-location',10000]] as const)await transaction(q=>upsertSquarePayment(q,{id,location_id:location,status:'COMPLETED',amount_money:{amount,currency:'USD'},created_at:'2026-10-15T12:00:00Z',updated_at:'2026-10-15T12:00:00Z'},'production'));
  await query("INSERT INTO wl.square_sync(environment,cursor,status) VALUES('production','{\"locations\":[\"old-location\"],\"paymentCursor\":\"old-account-cursor\"}','idle')");
  globalThis.fetch=async()=>Response.json({locations:[{id:'new-location'}]});
  assert.equal((await connectSquareAccount()).locations,1);
  assert.equal((await squareRevenueStatus()).count,1);
  assert.equal(Number((await query<{total:string}>("SELECT SUM(amount_cents)::text total FROM wl.revenue_payments"))[0].total),10000);
  assert.equal((await query("SELECT * FROM wl.square_payments")).length,2,'old records retained');
  assert.deepEqual((await query<{cursor:unknown}>("SELECT cursor FROM wl.square_sync WHERE environment='production'"))[0].cursor,{});
  const owner={id:'test',user_id:'10000000-0000-4000-8000-000000000001',name:'Owner',email:'test@example.test',role:'owner' as const};
  const current=await adminData('payments',new URLSearchParams(),owner);
  assert.equal((current.squarePayments as unknown[]).length,1);
  const archive=await adminData('payments',new URLSearchParams({squareArchive:'1'}),owner);
  assert.equal((archive.squarePayments as unknown[]).length,2);
 }finally{globalThis.fetch=fetchOriginal;await closeDatabase();}
});
