import type postgres from "postgres";

/** Sólo datos reconocibles del seed; no recalcula documentos ni vuelve a pisar ediciones. */
export async function simplifyDemoPerceptions(connection: postgres.Sql) {
  await connection.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(260028)`;
    const [company] =
      await tx`select id from companies where slug='distribuidora-parana'`;
    if (!company) return;
    const [applied] =
      await tx`select 1 from demo_seed_updates where company_id=${company.id} and version='iibb-two-examples'`;
    if (applied) return;
    const cities = [
      "Paraná",
      "Santa Fe",
      "Concordia",
      "Gualeguaychú",
      "Victoria",
      "Rosario",
      "Crespo",
    ];
    const shops = [
      "Kiosco",
      "Despensa",
      "Ferretería",
      "Super",
      "Bar",
      "Almacén",
      "Dietética",
    ];
    const rows = Array.from({ length: 36 }, (_, i) => ({
      code: `C${String(i + 1).padStart(4, "0")}`,
      base_name: `${shops[i % shops.length]} ${cities[i % cities.length]} ${i + 1}`,
      rate: i < 2 ? 300 : null,
    }));
    await tx`update customers c set name=case when v.rate::int=300 then v.base_name||' · DEMO IIBB 3%' else v.base_name end,iibb_perception_bps=v.rate::int from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as v(code text,base_name text,rate integer) where c.company_id=${company.id} and c.code=v.code and c.name=v.base_name and (c.iibb_perception_bps is null or c.iibb_perception_bps=300)`;
    await tx`insert into demo_seed_updates(company_id,version) values(${company.id},'iibb-two-examples')`;
  });
}
