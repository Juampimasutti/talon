import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../../scripts/load-env";

loadEnv();
const enabled = process.env.RUN_DB_TESTS === "1";
const database = `talon_tax_rls_${randomUUID().replaceAll("-", "")}`;
let admin: ReturnType<typeof postgres> | undefined;
let app: ReturnType<typeof postgres> | undefined;
let companyA = "";
let companyB = "";
let laura = "";
let mateo = "";

function urlFor(key: "DATABASE_URL_ADMIN" | "DATABASE_URL", db: string) {
  const url = new URL(process.env[key] ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Las pruebas de impuestos sólo permiten PostgreSQL local");
  }
  url.pathname = `/${db}`;
  return url.toString();
}

describe.skipIf(!enabled)("impuestos RLS", () => {
  beforeAll(async () => {
    const root = postgres(urlFor("DATABASE_URL_ADMIN", "postgres"), { max: 1, onnotice: () => {} });
    try {
      await root.unsafe(`create database ${database}`);
    } finally {
      await root.end();
    }
    const env = {
      ...process.env,
      DATABASE_URL_ADMIN: urlFor("DATABASE_URL_ADMIN", database),
      DATABASE_URL: urlFor("DATABASE_URL", database),
      ARCA_MODE: "mock",
    };
    process.env.DATABASE_URL_ADMIN = env.DATABASE_URL_ADMIN;
    process.env.DATABASE_URL = env.DATABASE_URL;
    execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env, stdio: "pipe", timeout: 180_000 });
    execFileSync(process.execPath, ["--import", "tsx", "scripts/seed.ts"], { env, stdio: "pipe", timeout: 180_000 });
    admin = postgres(env.DATABASE_URL_ADMIN, { max: 1, onnotice: () => {} });
    app = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
    const companies = await admin`select id,slug,enabled_modules from companies where slug in ('distribuidora-parana','costa-servicios')`;
    companyA = companies.find((row) => row.slug === "distribuidora-parana")!.id;
    companyB = companies.find((row) => row.slug === "costa-servicios")!.id;
    expect(companies.every((row) => !row.enabled_modules.includes("impuestos"))).toBe(true);
    const users = await admin`select id,email from users where email in ('hector@talon.demo','mateo@talon.demo')`;
    laura = users.find((row) => row.email === "hector@talon.demo")!.id;
    mateo = users.find((row) => row.email === "mateo@talon.demo")!.id;
  }, 180_000);

  afterAll(async () => {
    await Promise.all([admin?.end(), app?.end()]);
    const root = postgres(urlFor("DATABASE_URL_ADMIN", "postgres"), { max: 1, onnotice: () => {} });
    try {
      await root.unsafe(`drop database if exists ${database} with (force)`);
    } finally {
      await root.end();
    }
  }, 20_000);

  it("mantiene referencias globales de solo lectura y aísla empresas", async () => {
    await app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      const rates = await tx`select codigo,bps from imp_alicuotas order by codigo`;
      expect(rates).toHaveLength(6);
      const [references] = await tx`select
        (select count(*)::int from imp_condiciones_iva) condiciones,
        (select count(*)::int from imp_tipos_comprobante) comprobantes,
        (select count(*)::int from imp_codigos_operacion) operaciones,
        (select count(*)::int from imp_monedas) monedas,
        (select count(*)::int from imp_tipos_documento) documentos,
        (select count(*)::int from imp_matriz_letras) matriz`;
      expect(references).toEqual({ condiciones: 11, comprobantes: 133, operaciones: 9, monedas: 53, documentos: 36, matriz: 55 });
      await tx`insert into imp_config(company_id) values(${companyA})`;
    });
    await expect(app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      await tx`insert into imp_config(company_id) values(${companyB})`;
    })).rejects.toMatchObject({ code: "42501" });
    await app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${mateo},true)`;
      const rows = await tx`select * from imp_config`;
      expect(rows).toHaveLength(0);
    });
    await expect(app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${mateo},true)`;
      await tx`insert into imp_puntos_venta(company_id,numero,sistema) values(${companyA},1,'manual')`;
    })).rejects.toMatchObject({ code: "42501" });
  });

  it("sólo cierra al confirmar y exige permiso, motivo y auditoría para reabrir", async () => {
    await app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      await tx`insert into imp_periodos(company_id,periodo) values(${companyA},'202609') on conflict do nothing`;
    });
    await expect(app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      await tx`update imp_periodos set estado='cerrado' where company_id=${companyA} and periodo='202609'`;
    })).rejects.toMatchObject({code:"55000"});
    await app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      await tx`insert into imp_liquidaciones(company_id,periodo,estado,totales,snapshot,confirmada_por,confirmada_at,created_by)
        values(${companyA},'202609','confirmada','{}','{}',${laura},now(),${laura})`;
      const [closed]=await tx`select estado from imp_periodos where company_id=${companyA} and periodo='202609'`;
      expect(closed.estado).toBe("cerrado");
    });
    await expect(app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      await tx`update imp_liquidaciones set estado='borrador',snapshot=null,confirmada_por=null,confirmada_at=null where company_id=${companyA} and periodo='202609'`;
    })).rejects.toMatchObject({code:"55000"});
    await expect(app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      await tx`select imp_reabrir_periodo('202609','x')`;
    })).rejects.toMatchObject({code:"22023"});
    await app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      await tx`select imp_reabrir_periodo('202609','Corrección solicitada por el estudio')`;
      const [periodRow]=await tx`select estado from imp_periodos where company_id=${companyA} and periodo='202609'`;
      const [settlement]=await tx`select estado from imp_liquidaciones where company_id=${companyA} and periodo='202609'`;
      const [audit]=await tx`select metadata->>'motivo' motivo from audit_log where company_id=${companyA} and action='impuestos.reabrir' order by created_at desc limit 1`;
      expect(periodRow.estado).toBe("abierto"); expect(settlement.estado).toBe("borrador");
      expect(audit.motivo).toBe("Corrección solicitada por el estudio");
    });
    await expect(app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${mateo},true)`;
      await tx`select imp_reabrir_periodo('202609','Intento sin autorización')`;
    })).rejects.toMatchObject({code:"42501"});
  });

  it("incluye las 13 tablas tenant de impuestos en respaldo y restauración dinámica", async () => {
    const [snapshot]=await admin!`select company_snapshot(${companyA}) data`;
    const tenantTables=["imp_empresas","imp_config","imp_puntos_venta","imp_actividades","imp_contrapartes","imp_mapeo_tributos","imp_periodos","imp_import_jobs","imp_comprobantes","imp_comprobante_alicuotas","imp_import_rows","imp_liquidaciones","imp_liquidacion_items","imp_retenciones_percepciones","imp_retenciones_practicadas"];
    for(const table of tenantTables) expect(snapshot.data).toHaveProperty(table);
  });

  it("Traer de Talón no modifica ninguna tabla operativa de Talón", async () => {
    const [sample]=await admin!`select to_char(issued_on,'YYYYMM') period from documents where company_id=${companyA} and kind in ('venta','compra') order by issued_on limit 1`;
    if(!sample) return;
    const tableRows=await admin!`select distinct table_name from information_schema.columns where table_schema='public' and column_name='company_id' and table_name not like 'imp\_%' escape '\' order by table_name`;
    const checksum=async()=>Object.fromEntries(await Promise.all(tableRows.map(async({table_name})=>{
      const [row]=await admin!.unsafe(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) hash from public."${table_name}" t where company_id='${companyA}'`);
      return [table_name,row.hash] as const;
    })));
    const before=await checksum();
    const {getDb}=await import("./client"); const {traerDeTalon}=await import("@/lib/impuestos/traer-de-talon");
    await getDb().transaction(async tx=>{
      await tx.execute(sql`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`);
      await traerDeTalon(tx,companyA,laura,sample.period);
    });
    expect(await checksum()).toEqual(before);
  });

  it("importa con el alta en Talón apagada/prendida y reimporta como duplicado", async () => {
    const {getDb}=await import("./client"); const {importarMisComprobantes}=await import("@/lib/impuestos/importar");
    const emitted=readFileSync("src/lib/impuestos/__fixtures__/mis-comprobantes-emitidos-ejemplo.xlsx");
    const received=readFileSync("src/lib/impuestos/__fixtures__/mis-comprobantes-recibidos-ejemplo.xlsx");
    const before=(await admin!`select (select count(*)::int from customers where company_id=${companyA}) customers,(select count(*)::int from suppliers where company_id=${companyA}) suppliers`)[0];
    const run=(file:Buffer,name:string,also:boolean)=>getDb().transaction(async tx=>{
      await tx.execute(sql`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`);
      return importarMisComprobantes(tx,{companyId:companyA,userId:laura,companyCuit:"20111111112",canCreateCustomer:true,canCreateSupplier:true},file,name,"202609",also);
    });
    const first=await run(emitted,"emitidos.xlsx",false);
    const afterOff=(await admin!`select count(*)::int customers from customers where company_id=${companyA}`)[0];
    expect(first.rechazados).toBe(0); expect(afterOff.customers).toBe(before.customers);
    const repeated=await run(emitted,"emitidos.xlsx",false);
    expect(repeated.ok).toBe(0); expect(repeated.duplicados).toBe(first.ok+first.duplicados);
    // El contador de la demo solo consulta proveedores; para crear contrapartes necesita proveedores.crear.
    await admin!`insert into role_permissions(role_id,permission) select role_id,'proveedores.crear' from memberships where user_id=${laura} and company_id=${companyA} on conflict do nothing`;
    const on=await run(received,"recibidos.xlsx",true);
    const afterOn=(await admin!`select count(*)::int suppliers from suppliers where company_id=${companyA}`)[0];
    expect(on.rechazados).toBe(0); expect(afterOn.suppliers).toBeGreaterThanOrEqual(before.suppliers);
    const [linked]=await admin!`select count(*)::int count from imp_contrapartes where company_id=${companyA} and supplier_id is not null`;
    expect(linked.count).toBeGreaterThan(0);
  });

  it("permite borrar un comprobante importado y deja la fila del import sin vínculo", async () => {
    const [row]=await admin!`select r.id,r.comprobante_id from imp_import_rows r join imp_comprobantes c on c.id=r.comprobante_id
      left join imp_periodos p on p.company_id=c.company_id and p.periodo=c.periodo
      where r.company_id=${companyA} and coalesce(p.estado,'abierto')<>'cerrado' limit 1`;
    expect(row).toBeTruthy();
    await admin!`delete from imp_comprobante_alicuotas where comprobante_id=${row.comprobante_id}`;
    await admin!`delete from imp_comprobantes where id=${row.comprobante_id}`;
    const [after]=await admin!`select company_id,comprobante_id from imp_import_rows where id=${row.id}`;
    expect(after.company_id).toBe(companyA);
    expect(after.comprobante_id).toBeNull();
  });

  it("reserva los permisos de Impuestos al puesto contador", async () => {
    const [adminRole]=await admin!`select id from roles where company_id=${companyA} and key='admin'`;
    const [count]=await admin!`select count(*)::int n from role_permissions where role_id=${adminRole.id} and permission like 'impuestos.%'`;
    expect(count.n).toBe(0);
    await expect(admin!`insert into role_permissions(role_id,permission) values(${adminRole.id},'impuestos.ver')`).rejects.toThrow("exclusivos del puesto Contador");
    const [contador]=await admin!`select count(*)::int n from role_permissions rp join roles r on r.id=rp.role_id where r.company_id=${companyA} and r.key='contador' and rp.permission like 'impuestos.%'`;
    expect(contador.n).toBe(6);
  });

  it("TALON_MODO: aplica modo estudio idempotente, sin borrar datos, y vuelve a negocio", async () => {
    const { applyCompanyMode } = await import("../../../scripts/talon-modo-core");
    const [before]=await admin!`select enabled_modules,business_sector,(select count(*)::int from customers where company_id=${companyB}) customers from companies where id=${companyB}`;
    const first=await applyCompanyMode(admin!,"estudio",companyB);
    expect(first[0]).toMatchObject({changed:true,enabledModules:["impuestos"]});
    const second=await applyCompanyMode(admin!,"estudio",companyB);
    expect(second[0].changed).toBe(false);
    const [row]=await admin!`select tipo,enabled_modules,(select count(*)::int from customers where company_id=${companyB}) customers from companies where id=${companyB}`;
    expect(row.tipo).toBe("estudio");
    expect(row.enabled_modules).toEqual(["impuestos"]);
    expect(row.customers).toBe(before.customers);
    const [admins]=await admin!`select count(*)::int n from memberships m join roles r on r.id=m.role_id where m.company_id=${companyB} and r.key='admin'`;
    expect(admins.n).toBe(0);
    const [audits]=await admin!`select count(*)::int n from audit_log where company_id=${companyB} and action='configuracion.modo'`;
    expect(audits.n).toBe(1);
    const back=await applyCompanyMode(admin!,"negocio",companyB);
    expect(back[0].changed).toBe(true);
    expect(back[0].enabledModules).not.toContain("impuestos");
    expect(back[0].enabledModules).toContain("ventas");
    await expect(applyCompanyMode(admin!,"estudio","no-existe")).rejects.toThrow("No encontré");
  });

  it("aísla clientes dentro del estudio y mantiene el RLS entre estudios", async () => {
    const [first]=await admin!`select id from imp_empresas where company_id=${companyA} and activa order by created_at limit 1`;
    const [second]=await admin!`insert into imp_empresas(company_id,nombre,razon_social,cuit,condicion_iva,created_by)
      values(${companyA},'Cliente fiscal B','Cliente fiscal B SA','30709999995','ri',${laura}) returning id`;
    await app!.begin(async tx=>{
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true),set_config('app.imp_empresa_id',${first.id},true)`;
      await tx`insert into imp_periodos(company_id,periodo) values(${companyA},'202610')`;
      expect(await tx`select periodo from imp_periodos where periodo='202610'`).toHaveLength(1);
    });
    await app!.begin(async tx=>{
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true),set_config('app.imp_empresa_id',${second.id},true)`;
      expect(await tx`select periodo from imp_periodos where periodo='202610'`).toHaveLength(0);
      await tx`insert into imp_periodos(company_id,periodo) values(${companyA},'202610')`;
      expect(await tx`select periodo from imp_periodos where periodo='202610'`).toHaveLength(1);
    });
    const [otherStudy]=await admin!`select id from imp_empresas where company_id=${companyB} and activa limit 1`;
    await expect(app!.begin(async tx=>{
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true),set_config('app.imp_empresa_id',${otherStudy.id},true)`;
      await tx`insert into imp_periodos(company_id,empresa_cliente_id,periodo) values(${companyA},${otherStudy.id},'202611')`;
    })).rejects.toMatchObject({code:"42501"});
  });
});
