import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./auth";
import { transaction } from "./db";
import type { Session } from "./types";

const archiveInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("customer"), id: z.uuid(), action: z.enum(["archive", "restore"]) }),
  z.object({ kind: z.literal("square-profile"), id: z.string().min(1).max(192).regex(/^[A-Za-z0-9_-]+$/), action: z.enum(["archive", "restore"]) }),
]);

/** Remove contacts from the active directory without deleting financial or team records. */
export async function setCustomerArchived(user: Session, input: unknown) {
  if (user.role !== "owner" && user.role !== "admin") throw new AppError("Only an owner or admin can archive or restore customers.", 403);
  const data = archiveInput.parse(input), archived = data.action === "archive";
  return transaction(async q => {
    // Imports use the same lock: an import cannot recreate a visible profile while
    // its linked customer is being archived, and both paths lock in the same order.
    await q("LOCK TABLE wl.square_customer_history IN SHARE ROW EXCLUSIVE MODE");
    let affectedProfiles = 0;
    if (data.kind === "customer") {
      const customer = (await q<{ archived_at: string | null }>("SELECT archived_at FROM wl.customers WHERE id=$1 FOR UPDATE", [data.id])).rows[0];
      if (!customer) throw new AppError("Customer not found.", 404);
      if (Boolean(customer.archived_at) === archived) return { ok: true, archived, affected_profiles: 0 };
      await q("UPDATE wl.customers SET archived_at=CASE WHEN $2 THEN now() ELSE NULL END,updated_at=now() WHERE id=$1", [data.id, archived]);
      affectedProfiles = (await q(archived
        ? "UPDATE wl.square_customer_history SET archived_at=now(),archived_customer_id=$1 WHERE customer_id=$1 AND archived_at IS NULL RETURNING square_customer_id"
        : "UPDATE wl.square_customer_history SET archived_at=NULL,archived_customer_id=NULL WHERE customer_id=$1 AND archived_customer_id=$1 RETURNING square_customer_id", [data.id])).rows.length;
      if (archived) await q("UPDATE wl.messages SET status='cancelled',error='Customer archived' WHERE customer_id=$1 AND purpose='marketing' AND status IN ('queued','skipped','failed')", [data.id]);
      await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,before_data,after_data) VALUES($1,$2,'customer',$3,$4,$5::jsonb,$6::jsonb)",
        [randomUUID(), user.user_id, data.id, archived ? "archived" : "restored", JSON.stringify({ archived_at: customer.archived_at }), JSON.stringify({ archived, affected_profiles: affectedProfiles })]);
    } else {
      const profile = (await q<{ archived_at: string | null; customer_id: string | null }>("SELECT archived_at,customer_id FROM wl.square_customer_history WHERE square_customer_id=$1 FOR UPDATE", [data.id])).rows[0];
      if (!profile) throw new AppError("Square customer profile not found.", 404);
      if (!archived && profile.customer_id) {
        const customer = (await q<{ archived_at: string | null }>("SELECT archived_at FROM wl.customers WHERE id=$1", [profile.customer_id])).rows[0];
        if (customer?.archived_at) throw new AppError("Restore the linked customer before restoring this Square profile.", 409);
      }
      if (Boolean(profile.archived_at) === archived) return { ok: true, archived, affected_profiles: 0 };
      await q("UPDATE wl.square_customer_history SET archived_at=CASE WHEN $2 THEN now() ELSE NULL END,archived_customer_id=NULL WHERE square_customer_id=$1", [data.id, archived]);
      affectedProfiles = 1;
      await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,action,before_data,after_data) VALUES($1,$2,'square_customer_profile',$3,$4::jsonb,$5::jsonb)",
        [randomUUID(), user.user_id, archived ? "archived" : "restored", JSON.stringify({ square_customer_id: data.id, archived_at: profile.archived_at }), JSON.stringify({ square_customer_id: data.id, archived })]);
    }
    return { ok: true, archived, affected_profiles: affectedProfiles };
  });
}
