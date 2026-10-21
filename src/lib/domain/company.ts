import { sql } from "drizzle-orm";
import { allPermissions, MODULES, ROLE_TEMPLATES } from "../auth/permissions";
import { BASE_DOCUMENT_TYPES, type CreateCompanyInput } from "../company-setup";
import { formatCuit } from "../fiscal/cuit";
import { HttpError } from "../http";
import {
  roles,
  rolePermissions,
  documentTypes,
  cashAccounts,
  warehouses,
  priceLists,
  ledgerAccounts,
} from "../db/schema";
import { writeAudit } from "./audit";
import type { Tx } from "../db/tenant";

export async function createCompany(
  tx: Tx,
  token: string,
  input: CreateCompanyInput,
) {
  const allowed = new Set<string>(
    MODULES.filter((item) => item.toggle).map((item) => item.key),
  );
  if (
    input.enabledModules.some(
      (module) => !allowed.has(module) || module === "contabilidad",
    )
  )
    throw new HttpError(400, "Hay módulos que todavía no están disponibles");
  const payload = {
    ...input,
    cuit: formatCuit(input.cuit),
    pointOfSale: input.pointsOfSale[0],
    adminPermissions: allPermissions(),
  };
  const [row] = await tx.execute<{ id: string }>(
    sql`select company_bootstrap(${token},${JSON.stringify(payload)}::jsonb) as id`,
  );
  const id = row.id;
  await tx.execute(
    sql`select set_config('app.company_id',${id},true),set_config('app.user_id',lifecycle_actor(${token})::text,true)`,
  );
  const [actor] = await tx.execute<{ id: string }>(
    sql`select app_user_id()::text as id`,
  );
  const roleRows = await tx
    .insert(roles)
    .values(
      Object.entries(ROLE_TEMPLATES)
        .filter(([key]) => key !== "admin")
        .map(([key, template]) => ({
          companyId: id,
          key,
          name: template.name,
          description: template.description,
        })),
    )
    .returning();
  const permissions = roleRows.flatMap((role) =>
    ROLE_TEMPLATES[role.key].permissions.map((permission) => ({
      roleId: role.id,
      permission,
    })),
  );
  if (permissions.length) await tx.insert(rolePermissions).values(permissions);
  await tx
    .insert(cashAccounts)
    .values({ companyId: id, name: "Caja principal", kind: "caja" });
  await tx
    .insert(warehouses)
    .values({ companyId: id, name: "Depósito principal", isDefault: true });
  await tx
    .insert(priceLists)
    .values({ companyId: id, name: "General", isDefault: true });
  await tx.execute(
    sql`insert into company_points_of_sale(company_id,number) select ${id}::uuid,value::int from jsonb_array_elements_text(${JSON.stringify(input.pointsOfSale)}::jsonb) on conflict do nothing`,
  );
  const types = await tx
    .insert(documentTypes)
    .values(
      BASE_DOCUMENT_TYPES.map(
        ([
          code,
          name,
          kind,
          sign,
          movesStock,
          stockFactor,
          movesAccount,
          accountSide,
          movesCash,
          cashDirection,
          movesVat,
          afipCodes,
        ]) => ({
          companyId: id,
          code,
          name,
          kind,
          sign,
          movesStock,
          stockFactor,
          movesAccount,
          accountSide,
          movesCash,
          cashDirection,
          movesVat,
          electronic: false,
          afipCodes,
        }),
      ),
    )
    .returning();
  // Sólo depende del tamaño del catálogo, no del número de puntos: una inserción.
  await tx.execute(
    sql`insert into document_counters(company_id,document_type_id,point_of_sale,next_number) select ${id}::uuid,id,p.number,1 from document_types cross join company_points_of_sale p where document_types.company_id=${id} and p.company_id=${id}`,
  );
  if (
    input.enabledModules.includes("estacion") ||
    input.enabledModules.includes("reparto")
  ) {
    await tx.execute(
      sql`insert into fuel_products(company_id,code,name,unit) values(${id},'NS','Nafta súper','litro'),(${id},'NP','Nafta premium','litro'),(${id},'GO','Gasoil','litro'),(${id},'GNC','GNC','m3')`,
    );
  }
  if (input.basicLedger)
    await tx.insert(ledgerAccounts).values([
      { companyId: id, code: "1.1", name: "Caja y bancos", kind: "activo" },
      {
        companyId: id,
        code: "1.2",
        name: "Deudores por ventas",
        kind: "activo",
      },
      { companyId: id, code: "2.1", name: "Proveedores", kind: "pasivo" },
      { companyId: id, code: "4.1", name: "Ventas", kind: "ingreso" },
      { companyId: id, code: "5.1", name: "Compras y gastos", kind: "egreso" },
    ]);
  await writeAudit(tx, {
    companyId: id,
    userId: actor.id,
    action: "empresa.crear",
    entity: "empresa",
    entityId: id,
    summary: `Empresa creada: ${input.name}`,
    metadata: { pointsOfSale: input.pointsOfSale, documentTypes: types.length },
  });
  return { id };
}
