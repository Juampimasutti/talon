import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { can, effectiveModules, moduleEnabled, permissionAllowedForRole, type Action, type ModuleKey } from "./permissions";
import { HttpError } from "../http";

export type MembershipView = {
  companyId: string;
  companyName: string;
  legalName: string;
  cuit: string;
  taxCondition: string;
  pointOfSale: number;
  city: string | null;
  province: string | null;
  enabledModules: string[];
  businessSector?: string;
  tipo?: string;
  blockNegativeStock: boolean;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
};

export type AuthContext = {
  user: { id: string; name: string; email: string };
  memberships: MembershipView[];
  company: MembershipView;
  permissions: Set<string>;
  rlsEnforced: boolean;
};

const SESSION_COOKIE = "talon_session";
const COMPANY_COOKIE = "talon_company";
const MAX_AGE = 60 * 60 * 24 * 14;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

let rlsEnforced: boolean | null = null;

async function roleEnforcesRls(): Promise<boolean> {
  if (rlsEnforced !== null) return rlsEnforced;
  const rows = await getDb().execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
    sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
  );
  const row = rows[0];
  rlsEnforced = Boolean(row) && !row.rolsuper && !row.rolbypassrls;
  return rlsEnforced;
}

function asMembership(value: unknown): MembershipView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as MembershipView;
  if (!row.companyId || !row.roleId) return null;
  return {
    ...row,
    // Impuestos no se ofrece a negocios de rubro comercio/estación: se filtra acá para que
    // menú, requirePermission y API usen la misma lista (ver effectiveModules).
    enabledModules: effectiveModules(row.enabledModules ?? [], row),
    permissions: row.permissions ?? [],
    pointOfSale: Number(row.pointOfSale ?? 1),
  };
}

export async function getAuth(): Promise<AuthContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const selectedCompanyId = jar.get(COMPANY_COOKIE)?.value;
  const session = await authFromToken(token, selectedCompanyId);
  if (!session) return null;
  // Each browser session owns its selection; the saved home is only a legacy fallback.
  if (selectedCompanyId) return session;
  const home = await getDb().execute<{ company_id: string | null }>(sql`select auth_home_company(${session.user.id}::uuid) as company_id`);
  const companyId = home[0]?.company_id;
  if (!companyId || companyId === session.company.companyId) return session;
  return (await authFromToken(token, companyId)) ?? session;
}

export async function authFromToken(token: string, requestedCompanyId?: string): Promise<AuthContext | null> {
  const rows = await getDb().execute<{ ctx: { user: AuthContext["user"]; memberships: unknown[] } | null }>(
    sql`select auth_context(${tokenHash(token)}) as ctx`,
  );
  const ctx = rows[0]?.ctx;
  if (!ctx?.user || !Array.isArray(ctx.memberships) || ctx.memberships.length === 0) return null;
  const memberships = ctx.memberships.map(asMembership).filter((item): item is MembershipView => Boolean(item));
  if (memberships.length === 0) return null;
  const company = memberships.find((item) => item.companyId === requestedCompanyId) ?? memberships[0];
  return {
    user: ctx.user,
    memberships,
    company,
    // Los módulos exclusivos de un puesto (Impuestos → contador) se filtran acá:
    // así quedan fuera del menú y de requirePermission aunque la base tuviera otra cosa.
    permissions: new Set(company.permissions.filter((permission) => permissionAllowedForRole(company.roleKey, permission))),
    rlsEnforced: await roleEnforcesRls(),
  };
}

export async function requirePermission(module: ModuleKey, action: Action): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) throw new HttpError(401, "Tenés que iniciar sesión");
  if (!moduleEnabled(auth.company.enabledModules, module)) {
    throw new HttpError(403, "Este módulo no está activo en la empresa");
  }
  if (!can(auth.permissions, module, action)) {
    throw new HttpError(403, "No tenés permiso para hacer eso");
  }
  return auth;
}

export function publicUser(auth: AuthContext) {
  return {
    user: auth.user,
    company: {
      id: auth.company.companyId,
      name: auth.company.companyName,
      legalName: auth.company.legalName,
      cuit: auth.company.cuit,
      taxCondition: auth.company.taxCondition,
      pointOfSale: auth.company.pointOfSale,
      city: auth.company.city,
      province: auth.company.province,
      modules: auth.company.enabledModules,
      businessSector: auth.company.businessSector ?? "comercio",
      tipo: auth.company.tipo ?? "negocio",
      blockNegativeStock: auth.company.blockNegativeStock,
    },
    role: { id: auth.company.roleId, key: auth.company.roleKey, name: auth.company.roleName },
    permissions: [...auth.permissions],
    companies: auth.memberships.map((item) => ({
      id: item.companyId,
      name: item.companyName,
      roleName: item.roleName,
    })),
    rlsEnforced: auth.rlsEnforced,
  };
}

export function cookieBase() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.TALON_COOKIE_SECURE === "1",
    path: "/",
    maxAge: MAX_AGE,
  };
}

export async function startSession(userId: string, companyId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + MAX_AGE * 1000).toISOString();
  await getDb().execute(sql`select auth_create_session(${userId}::uuid, ${tokenHash(token)}, ${expires}::timestamptz)`);
  const jar = await cookies();
  const base = cookieBase();
  jar.set(SESSION_COOKIE, token, base);
  jar.set(COMPANY_COOKIE, companyId, base);
  return token;
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDb().execute(sql`select auth_delete_session(${tokenHash(token)})`);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(COMPANY_COOKIE);
}

export async function switchCompany(companyId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COMPANY_COOKIE, companyId, cookieBase());
}
