import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as query } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { createCompany } from "../src/lib/domain/company";
import { buildCuit } from "../src/lib/fiscal/cuit";
import { SECTORS } from "../src/lib/company-setup";
import { addMonths } from "../src/lib/estate-rules";
export async function seedConstructora(connection: postgres.Sql) {
  const db = drizzle(connection, { schema });
  await db.transaction(async (tx) => {
    await tx.execute(query`select pg_advisory_xact_lock(260029)`);
    const [existing] = await tx
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.slug, "constructora-demo"));
    if (existing) return;
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "laura@talon.demo"));
    if (!user) throw Error("Falta el usuario demo");
    const [operator] = await tx.execute(
      query`select 1 from company_operators where user_id=${user.id}`,
    );
    if (!operator)
      await tx.execute(
        query`insert into company_operators(user_id,scope) values(${user.id},'estudio')`,
      );
    const token = randomBytes(32).toString("hex");
    await tx.execute(
      query`insert into sessions(user_id,token_hash,expires_at) values(${user.id},${token},now()+interval '5 minutes')`,
    );
    const { id } = await createCompany(tx, token, {
      name: "Constructora Demo",
      legalName: "Constructora Demo SRL",
      cuit: buildCuit("30", "61234568"),
      taxCondition: "ri",
      iibb: "",
      address: "Obrador ficticio 456",
      city: "Paraná",
      province: "Entre Ríos",
      activityStartedOn: "2026-01-01",
      businessSector: "constructora",
      pointsOfSale: [1],
      enabledModules: [...SECTORS.constructora.modules],
      basicLedger: false,
    });
    await tx
      .update(schema.companies)
      .set({ slug: "constructora-demo" })
      .where(eq(schema.companies.id, id));
    const [customer] = await tx
      .insert(schema.customers)
      .values({
        companyId: id,
        code: "C0001",
        name: "DEMO · Cliente de obra",
        taxCondition: "ri",
      })
      .returning();
    const [supplier] = await tx
      .insert(schema.suppliers)
      .values({
        companyId: id,
        code: "P0001",
        name: "DEMO · Subcontratista",
        taxCondition: "ri",
      })
      .returning();
    const [warehouse] = await tx
      .insert(schema.warehouses)
      .values({
        companyId: id,
        name: "DEMO · Depósito de obra",
        isDefault: false,
      })
      .returning();
    const first = `${new Date().toISOString().slice(0, 7)}-01`;
    const [work] = await tx.execute<{ id: string }>(
      query`insert into construction_works(company_id,name,customer_id,location,responsible,starts_on,ends_on,warehouse_id,repair_bps,vat_bps) values(${id},'DEMO · Obra piloto',${customer.id},'Ubicación de prueba 789','Responsable DEMO',${addMonths(first, -2)},${addMonths(first, 12)},${warehouse.id},500,2100) returning id`,
    );
    await tx.execute(
      query`insert into construction_items(company_id,work_id,rubro,description,kind,quantity_milli,unit_price_cents,global_item) values(${id},${work.id},'Albañilería','DEMO · Mampostería','material',10000,100000,false),(${id},${work.id},'Instalaciones','DEMO · Instalación global','mano_obra',1000,200000,true)`,
    );
    await tx.execute(
      query`insert into construction_subcontracts(company_id,work_id,supplier_id,description,amount_cents,retention_bps) values(${id},${work.id},${supplier.id},'DEMO · Instalación eléctrica',200000,500)`,
    );
    await tx.execute(
      query`insert into construction_units(company_id,work_id,name,price_cents) values(${id},${work.id},'DEMO · Unidad 1',10000000)`,
    );
    const [product] = await tx
      .insert(schema.products)
      .values({
        companyId: id,
        sku: "DEMO-CON-001",
        name: "DEMO · Material para acopio",
        costCents: 1000,
        ivaRateBps: 2100,
        minStock: 10,
      })
      .returning();
    const [central] = await tx
      .select()
      .from(schema.warehouses)
      .where(
        query`${schema.warehouses.companyId}=${id} and ${schema.warehouses.isDefault}=true`,
      );
    await tx
      .insert(schema.stockLevels)
      .values({
        companyId: id,
        productId: product.id,
        warehouseId: central.id,
        quantity: 200,
      });
    await tx
      .insert(schema.stockMovements)
      .values({
        companyId: id,
        productId: product.id,
        warehouseId: central.id,
        quantity: 200,
        reason: "Apertura ficticia de demo",
        createdBy: user.id,
      });
    await tx.execute(query`delete from sessions where token_hash=${token}`);
    if (!operator)
      await tx.execute(
        query`delete from company_operators where user_id=${user.id}`,
      );
    console.log(
      "Constructora Demo lista: obra, presupuesto, subcontrato, unidad y stock ficticios.",
    );
  });
}
