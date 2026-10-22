import type postgres from "postgres";
import { ESTUDIO_MODULES, SECTORS, type CompanyMode } from "../src/lib/company-setup";

export type ModeResult = { id: string; slug: string; changed: boolean; enabledModules: string[] };

/**
 * Aplica el modo a una empresa (id o slug) o a "todas". Idempotente: correrlo dos
 * veces deja lo mismo y no escribe auditoría la segunda vez. Nunca borra datos:
 * sólo cambia companies.tipo, companies.enabled_modules y, en modo estudio, pasa
 * a Contador a los miembros de Administración (Impuestos es exclusivo de Contador).
 * - estudio: enabled_modules = ['impuestos'] (sueldos se sumará cuando exista).
 * - negocio: si venía de estudio, vuelven los módulos del rubro; si ya era negocio,
 *   no toca sus módulos.
 */
export async function applyCompanyMode(sql: postgres.Sql, mode: CompanyMode, target: string): Promise<ModeResult[]> {
  return sql.begin(async (tx) => {
    const rows = target === "todas"
      ? await tx<{ id: string; slug: string; tipo: string; enabled_modules: string[]; business_sector: string }[]>`select id, slug, tipo, enabled_modules, business_sector from companies where sandbox_of is null order by created_at for update`
      : await tx<{ id: string; slug: string; tipo: string; enabled_modules: string[]; business_sector: string }[]>`select id, slug, tipo, enabled_modules, business_sector from companies where id::text = ${target} or slug = ${target} for update`;
    if (!rows.length) throw new Error(`No encontré la empresa «${target}»`);
    const results: ModeResult[] = [];
    for (const row of rows) {
      const modules = mode === "estudio"
        ? [...ESTUDIO_MODULES]
        : row.tipo === "estudio"
          ? [...(SECTORS[row.business_sector as keyof typeof SECTORS] ?? SECTORS.comercio).modules]
          : row.enabled_modules;
      let changed = row.tipo !== mode || JSON.stringify([...row.enabled_modules].sort()) !== JSON.stringify([...modules].sort());
      if (changed) {
        await tx`update companies set tipo = ${mode}, enabled_modules = ${tx.array(modules)} where id = ${row.id}`;
      }
      if (mode === "estudio") {
        const [contador] = await tx<{ id: string }[]>`select id from roles where company_id = ${row.id} and key = 'contador'`;
        if (contador) {
          const granted = await tx`insert into role_permissions(role_id, permission) values (${contador.id}, 'configuracion.ver'), (${contador.id}, 'configuracion.editar') on conflict do nothing returning 1`;
          const moved = await tx`update memberships m set role_id = ${contador.id} from roles r where r.id = m.role_id and r.key = 'admin' and m.company_id = ${row.id} returning 1`;
          changed = changed || granted.length > 0 || moved.length > 0;
        }
      }
      if (changed) {
        await tx`insert into audit_log(company_id, action, entity, entity_id, summary, metadata)
          values (${row.id}, 'configuracion.modo', 'empresa', ${row.id}, ${`Modo ${mode} aplicado por el instalador (TALON_MODO)`},
                  ${tx.json({ antes: { tipo: row.tipo, modulos: row.enabled_modules }, despues: { tipo: mode, modulos: modules } })})`;
      }
      results.push({ id: row.id, slug: row.slug, changed, enabledModules: modules });
    }
    return results;
  });
}
