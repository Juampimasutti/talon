import { createCompany } from "@/lib/domain/company";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { getAuth, switchCompany } from "@/lib/auth/session";
import { createCompanySchema } from "@/lib/company-setup";
import { HttpError, ok } from "@/lib/http";
import { readBody } from "@/lib/validation";

export async function companyManagement(
  method: string,
  path: string[],
  req: Request,
) {
  const token = (await cookies()).get("talon_session")?.value;
  if (!token) throw new HttpError(401, "Tenés que iniciar sesión");
  const hash = createHash("sha256").update(token).digest("hex");
  const [valid] = await getDb().execute<{ actor: string | null }>(
    sql`select lifecycle_actor(${hash})::text as actor`,
  );
  if (!valid.actor) throw new HttpError(401, "La sesión venció");
  const [, id, action] = path;
  if (method === "GET" && id === "capacidades") {
    const [row] = await getDb().execute<{ canCreate: boolean; valid: boolean }>(
      sql`select company_can_create(${hash}) as "canCreate", lifecycle_actor(${hash}) is not null as valid`,
    );
    if (!row.valid) throw new HttpError(401, "La sesión venció");
    const auth = await getAuth();
    return ok({
      canCreate: row.canCreate,
      canDestroy: auth?.company.roleKey === "admin",
    });
  }
  if (method === "POST" && !id) {
    const input = await readBody(req, createCompanySchema);
    const created = await getDb().transaction((tx) =>
      createCompany(tx, hash, input),
    );
    await switchCompany(created.id);
    return ok(created);
  }
  if (method === "GET" && id === "respaldos" && !action) {
    const [row] = await getDb().execute<{ backups: unknown }>(
      sql`select company_backups(${hash}) as backups`,
    );
    return ok({ items: row.backups });
  }
  if (method === "GET" && id === "respaldos" && action) {
    const backupId = z.string().uuid().safeParse(action);
    if (!backupId.success) throw new HttpError(400, "Respaldo inválido");
    const [row] = await getDb().execute<{ backup: unknown }>(
      sql`select company_backup_download(${hash},${backupId.data}::uuid) as backup`,
    );
    if (!row.backup) throw new HttpError(404, "No encontramos el respaldo");
    return new Response(JSON.stringify(row.backup), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="talon-respaldo-${backupId.data}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (
    method === "POST" &&
    id &&
    (action === "vaciar" || action === "eliminar")
  ) {
    if (!z.string().uuid().safeParse(id).success)
      throw new HttpError(400, "Empresa inválida");
    const auth = await getAuth();
    if (!auth || auth.company.companyId !== id)
      throw new HttpError(403, "Seleccioná la empresa que querés administrar");
    const body = await readBody(
      req,
      z.object({ confirmation: z.string().min(1).max(120) }),
    );
    if (body.confirmation !== auth.company.companyName)
      throw new HttpError(400, "Escribí el nombre exacto de la empresa");
    const [row] = await getDb().execute<{ backupId: string }>(
      sql`select company_destroy(${hash},${id}::uuid,${action},${body.confirmation})::text as "backupId"`,
    );
    return ok({
      backupId: row.backupId,
      downloadUrl: `/api/empresas/respaldos/${row.backupId}`,
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}
