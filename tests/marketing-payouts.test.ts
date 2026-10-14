import test from "node:test";
import assert from "node:assert/strict";
import {commissionPaymentStatus,weeklyPayouts,payoutWeek,type PayoutRow} from "../lib/marketing-payouts";
const row:PayoutRow={id:"job",booking_date:"2026-10-10",completed_at:"2026-10-12T02:00:00Z",status:"completed",state:"Ready for approval",basis_cents:40000,rate_bps:1000,earned_cents:4000,paid_cents:0,due_cents:0,can_approve:true,collected_cents:40000,refunded_cents:0};
test("payout display distinguishes pending, ready, paid and adjustments",()=>{
 assert.equal(commissionPaymentStatus({...row,state:"Awaiting completion",earned_cents:0,can_approve:false,status:"new"}),"Pending");
 assert.equal(commissionPaymentStatus(row),"Ready for payout");
 assert.equal(commissionPaymentStatus({...row,can_approve:false,paid_cents:4000,state:"Settled"}),"Paid");
 assert.equal(commissionPaymentStatus({...row,paid_cents:4000,earned_cents:3000,state:"Adjustment required"}),"Adjustment needed");
});
test("weekly earnings use Chicago completion day and retain unpaid balances across weeks",()=>{
 assert.equal(payoutWeek("2026-10-11"),"2026-10-05");
 const weeks=weeklyPayouts([row,{...row,id:"next",completed_at:"2026-10-12T12:00:00Z",paid_cents:1000}, {...row,id:"pending",earned_cents:0,paid_cents:0,can_approve:false}]);
 assert.deepEqual(weeks,[{week:"2026-10-12",earnings_cents:4000,paid_cents:1000,ready_cents:3000,count:1},{week:"2026-10-05",earnings_cents:4000,paid_cents:0,ready_cents:4000,count:1}]);
});
