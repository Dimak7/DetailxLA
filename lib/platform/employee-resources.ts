import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, hash, passwordHash, rateLimit } from "./auth";
import { query, transaction, type Query } from "./db";
import { siteUrl } from "./settings";
import type { Role, Session } from "./types";

export type EmployeeResourceKind = "training" | "checklist" | "contract" | "document";
export type EmployeeResource = {
  id: string;
  title: string;
  kind: EmployeeResourceKind;
  url: string;
  description: string;
  employee_id: string | null;
  employee_name: string | null;
  active: boolean;
  can_edit: boolean;
};
export type ResourceEmployee = { id: string; name: string; active: boolean };
export type EmployeeResourceData = {
  resources: EmployeeResource[];
  employees: ResourceEmployee[];
  can_manage: boolean;
  login_email: string;
};

function requireManager(user: Session) {
  if (!["owner", "admin", "manager"].includes(user.role))
    throw new AppError("Only managers and administrators can manage employee resources.", 403);
}

function canManageRole(actor: Role, target: Role) {
  return actor === "owner" || (actor === "admin" && target !== "owner") || (actor === "manager" && target === "staff");
}

type EmployeeTarget = {
  id: string; user_id: string | null; name: string; email: string; active: boolean;
  login_role: Role; login_active: boolean | null; removed_at: string | null;
};
async function targetEmployee(q: Query, employeeId: string, user: Session, requireActive = true) {
  const employee = (await q<EmployeeTarget>(
    `SELECT e.id,e.user_id,e.name,e.email,e.active,COALESCE(u.role,'staff') login_role,u.active login_active,u.removed_at
     FROM wl.employees e LEFT JOIN wl.users u ON u.id=e.user_id WHERE e.id=$1 FOR UPDATE OF e`,
    [employeeId],
  )).rows[0];
  if (!employee) throw new AppError("Employee not found.", 404);
  if (!canManageRole(user.role, employee.login_role))
    throw new AppError("Your role cannot manage this employee's private information.", 403);
  if (requireActive && (!employee.active || employee.login_active === false || employee.removed_at))
    throw new AppError("This employee is inactive. Review their profile and login access first.", 409);
  return employee;
}

export async function employeeResourceData(user: Session, manage = false): Promise<EmployeeResourceData> {
  if (manage) requireManager(user);
  const permissions = manage
    ? `(r.employee_id IS NULL OR e.user_id=$1 OR $2='owner' OR ($2='admin' AND COALESCE(u.role,'staff')<>'owner') OR ($2='manager' AND COALESCE(u.role,'staff')='staff'))`
    : `r.active=true AND (r.employee_id IS NULL OR (e.user_id=$1 AND e.active=true))`;
  const resources = await query<EmployeeResource>(
    `SELECT r.id,r.title,r.kind,r.url,r.description,r.employee_id,e.name employee_name,r.active,
      ($2 IN ('owner','admin','manager') AND (r.employee_id IS NULL OR $2='owner' OR ($2='admin' AND COALESCE(u.role,'staff')<>'owner') OR ($2='manager' AND COALESCE(u.role,'staff')='staff'))) can_edit
     FROM wl.employee_resources r LEFT JOIN wl.employees e ON e.id=r.employee_id LEFT JOIN wl.users u ON u.id=e.user_id
     WHERE ${permissions} ORDER BY r.active DESC,r.kind,r.title,r.id`,
    [user.user_id, user.role],
  );
  const employees = manage ? await query<ResourceEmployee>(
    `SELECT e.id,e.name,e.active FROM wl.employees e LEFT JOIN wl.users u ON u.id=e.user_id
     WHERE u.removed_at IS NULL AND ($1='owner' OR ($1='admin' AND COALESCE(u.role,'staff')<>'owner') OR ($1='manager' AND COALESCE(u.role,'staff')='staff'))
     ORDER BY e.active DESC,e.name`, [user.role],
  ) : [];
  return { resources, employees, can_manage: manage, login_email: user.email };
}

const resourceInput = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(2, "Give this resource a title.").max(140),
  kind: z.enum(["training", "checklist", "contract", "document"]),
  url: z.string().trim().max(2048).url("Enter a valid link.").refine(value => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use an http or https link without a username or password."),
  description: z.string().trim().max(2000).default(""),
  employee_id: z.uuid().nullable().default(null),
  active: z.boolean().default(true),
}).refine(value => value.kind !== "contract" || value.employee_id !== null, {
  message: "Contracts must be assigned to one employee.", path: ["employee_id"],
});

export async function saveEmployeeResource(input: unknown, user: Session) {
  requireManager(user);
  const resource = resourceInput.parse(input);
  return transaction(async q => {
    const before = resource.id ? (await q<EmployeeResource>("SELECT * FROM wl.employee_resources WHERE id=$1 FOR UPDATE", [resource.id])).rows[0] : undefined;
    if (resource.id && !before) throw new AppError("Resource not found.", 404);
    if (before?.employee_id) await targetEmployee(q, before.employee_id, user, false);
    if (resource.employee_id) await targetEmployee(q, resource.employee_id, user);
    // A private contract must never become a shared document through an edit.
    if (before?.kind === "contract" && resource.employee_id === null)
      throw new AppError("Keep this contract assigned to an employee.");
    const id = resource.id || randomUUID();
    await q(
      `INSERT INTO wl.employee_resources(id,title,kind,url,description,employee_id,active,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(id) DO UPDATE SET title=$2,kind=$3,url=$4,description=$5,employee_id=$6,active=$7,updated_at=now()`,
      [id, resource.title, resource.kind, resource.url, resource.description, resource.employee_id, resource.active, user.user_id],
    );
    await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,after_data) VALUES($1,$2,'employee_resource',$3,'saved',$4::jsonb)",
      [randomUUID(), user.user_id, id, JSON.stringify({ title: resource.title, kind: resource.kind, employee_id: resource.employee_id, active: resource.active })]);
    return { id };
  });
}

export async function archiveEmployeeResource(input: unknown, user: Session) {
  requireManager(user);
  const { id } = z.object({ id: z.uuid() }).parse(input);
  return transaction(async q => {
    const resource = (await q<EmployeeResource>("SELECT * FROM wl.employee_resources WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!resource) throw new AppError("Resource not found.", 404);
    if (resource.employee_id) await targetEmployee(q, resource.employee_id, user, false);
    await q("UPDATE wl.employee_resources SET active=false,updated_at=now() WHERE id=$1", [id]);
    await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action) VALUES($1,$2,'employee_resource',$3,'archived')", [randomUUID(), user.user_id, id]);
    return { id };
  });
}

/** A manager shares this one-use link directly; no email or temporary password is sent. */
export async function createEmployeeAccessLink(input: unknown, user: Session) {
  requireManager(user);
  const { employee_id } = z.object({ employee_id: z.uuid() }).parse(input);
  await rateLimit("employee-access-link:" + user.user_id, 20, 900);
  const token = randomBytes(32).toString("hex");
  const result = await transaction(async q => {
    const employee = await targetEmployee(q, employee_id, user);
    const email = z.email("Set a valid email on the employee profile first.").parse(employee.email.trim().toLowerCase());
    let userId = employee.user_id;
    let createdLogin = false;
    if (!userId) {
      const accounts = (await q<{ id: string; role: Role; active: boolean; removed_at: string | null }>(
        "SELECT id,role,active,removed_at FROM wl.users WHERE lower(btrim(email))=$1 FOR UPDATE", [email],
      )).rows;
      if (accounts.length > 1) throw new AppError("More than one login uses this email. An administrator must resolve the duplicate accounts.", 409);
      const account = accounts[0];
      if (account) {
        if (!canManageRole(user.role, account.role)) throw new AppError("Your role cannot manage this employee account.", 403);
        if (!account.active || account.removed_at) throw new AppError("This login is inactive. Review its access before creating a setup link.", 409);
        if ((await q("SELECT id FROM wl.employees WHERE user_id=$1 AND id<>$2", [account.id, employee.id])).rows.length)
          throw new AppError("This email already belongs to another employee profile.", 409);
        userId = account.id;
      } else {
        userId = randomUUID();
        await q("INSERT INTO wl.users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,'staff',true)",
          [userId, employee.name, email, passwordHash(randomBytes(32).toString("hex"))]);
        createdLogin = true;
      }
      await q("UPDATE wl.employees SET user_id=$2,email=$3,updated_at=now() WHERE id=$1", [employee.id, userId, email]);
    }
    const account = (await q<{ email: string; role: Role; active: boolean; removed_at: string | null }>(
      "SELECT email,role,active,removed_at FROM wl.users WHERE id=$1 FOR UPDATE", [userId],
    )).rows[0];
    if (!account || !account.active || account.removed_at) throw new AppError("Employee login is inactive.", 409);
    if (!canManageRole(user.role, account.role)) throw new AppError("Your role cannot manage this employee account.", 403);
    await q("UPDATE wl.password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [userId]);
    const expiresAt = (await q<{ expires_at: string | Date }>(
      "INSERT INTO wl.password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes') RETURNING expires_at", [hash(token), userId],
    )).rows[0].expires_at;
    await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,after_data) VALUES($1,$2,'employee',$3,'login_link_created',$4::jsonb)",
      [randomUUID(), user.user_id, employee.id, JSON.stringify({ user_id: userId, created_login: createdLogin, expires_in_minutes: 30 })]);
    return { email: account.email, expires_at: new Date(expiresAt).toISOString(), created_login: createdLogin };
  });
  return { ...result, url: siteUrl() + "/admin/reset?token=" + token, login_url: siteUrl() + "/admin/login" };
}
