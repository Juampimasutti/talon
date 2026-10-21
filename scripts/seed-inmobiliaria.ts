import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as query } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { createCompany } from "../src/lib/domain/company";
import { buildCuit } from "../src/lib/fiscal/cuit";
import { SECTORS } from "../src/lib/company-setup";
import { addMonths } from "../src/lib/estate-rules";

export async function seedInmobiliaria(connection: postgres.Sql) {
  const db = drizzle(connection, { schema });
  await db.transaction(async (tx) => {
    await tx.execute(query`select pg_advisory_xact_lock(260027)`);
    const [existing] = await tx
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.slug, "inmobiliaria-demo"));
    if (existing) return;
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "laura@talon.demo"));
    if (!user) throw Error("Falta el usuario de demostración");
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
      name: "Inmobiliaria Demo",
      legalName: "Inmobiliaria Demo SRL",
      cuit: buildCuit("30", "61234567"),
      taxCondition: "ri",
      iibb: "",
      address: "Calle de prueba 123",
      city: "Paraná",
      province: "Entre Ríos",
      activityStartedOn: "2026-01-01",
      businessSector: "inmobiliaria",
      pointsOfSale: [1],
      enabledModules: [...SECTORS.inmobiliaria.modules],
      basicLedger: false,
    });
    await tx
      .update(schema.companies)
      .set({ slug: "inmobiliaria-demo" })
      .where(eq(schema.companies.id, id));
    const [owner] = await tx
      .insert(schema.customers)
      .values({
        companyId: id,
        code: "C0001",
        name: "DEMO · Propietario",
        taxCondition: "ri",
      })
      .returning();
    const [tenant] = await tx
      .insert(schema.customers)
      .values({
        companyId: id,
        code: "C0002",
        name: "DEMO · Inquilino",
        taxCondition: "cf",
      })
      .returning();
    const [supplier] = await tx
      .insert(schema.suppliers)
      .values({
        companyId: id,
        code: "P0001",
        name: "DEMO · Propietario",
        taxCondition: "ri",
      })
      .returning();
    const [property] = await tx.execute<{ id: string }>(
      query`insert into estate_properties(company_id,address,kind,owner_customer_id,owner_supplier_id) values(${id},'DEMO · Departamento Calle de prueba 123','depto',${owner.id},${supplier.id}) returning id`,
    );
    await tx.execute(
      query`insert into estate_properties(company_id,address,kind,owner_customer_id,owner_supplier_id) values(${id},'DEMO · Local disponible 456','local',${owner.id},${supplier.id})`,
    );
    const month = new Date().toISOString().slice(0, 7);
    const first = `${month}-01`;
    const starts = addMonths(first, -3);
    const ends = addMonths(first, 12);
    const [contract] = await tx.execute<{ id: string }>(
      query`insert into estate_contracts(company_id,property_id,owner_customer_id,owner_supplier_id,tenant_id,starts_on,ends_on,initial_rent_cents,current_rent_cents,adjustment_method,adjustment_months,due_day,last_adjustment_on) values(${id},${property.id},${owner.id},${supplier.id},${tenant.id},${starts},${ends},10000000,10000000,'manual',3,10,${starts}) returning id`,
    );
    await tx.execute(
      query`update estate_properties set status='alquilada' where id=${property.id}`,
    );
    const [charge] = await tx.execute<{ id: string }>(
      query`insert into estate_charges(company_id,contract_id,period,due_on,rent_cents,extras_cents,expenses_cents,notes) values(${id},${contract.id},${month},${`${month}-10`},10000000,500000,500000,'Liquidación ficticia, sin comisión ni mora configuradas') returning id`,
    );
    await tx
      .insert(schema.currentAccountEntries)
      .values({
        companyId: id,
        partyType: "customer",
        partyId: tenant.id,
        occurredOn: first,
        description: `Alquiler ${month} · ${charge.id}`,
        debitCents: 10500000,
      });
    await tx.execute(query`delete from sessions where token_hash=${token}`);
    if (!operator)
      await tx.execute(
        query`delete from company_operators where user_id=${user.id}`,
      );
    console.log(
      "Inmobiliaria Demo lista: propiedades, contrato y alquiler pendiente ficticios.",
    );
  });
}
