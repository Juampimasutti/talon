import { applyCompanyMode } from "./talon-modo-core";
import { defaultCompanyMode } from "../src/lib/company-setup";
import { simplifyDemoPerceptions } from "./seed-demo-perceptions";
import { seedConstructora } from "./seed-constructora";
import { seedInmobiliaria } from "./seed-inmobiliaria";
import { loadEnv } from "./load-env";
import { seedStation } from "./seed-estacion";
import { syncSystemRoles } from "./sync-roles";

loadEnv();

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function daysAgo(rand: () => number, max: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.floor(rand() * max));
  return date.toISOString().slice(0, 10);
}

async function main() {
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { eq } = await import("drizzle-orm");
  const schema = await import("../src/lib/db/schema");
  const { hashPassword } = await import("../src/lib/auth/password");
  const { ROLE_TEMPLATES } = await import("../src/lib/auth/permissions");
  const { buildCuit } = await import("../src/lib/fiscal/cuit");
  const { createDocument } = await import("../src/lib/domain/documents");

  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("Falta DATABASE_URL_ADMIN");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql, { schema });

  const existing = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.slug, "distribuidora-parana"));
  if (existing.length > 0) {
    console.log("La empresa demo ya está cargada");
    await seedStation(sql);
    await syncSystemRoles(sql);
    await seedInmobiliaria(sql);
    await seedConstructora(sql);
    await simplifyDemoPerceptions(sql);
    await sql.end();
    return;
  }

  const passwordHash = hashPassword("talon1234");
  const rand = mulberry32(20261019);

  await db.transaction(async (tx) => {
    const [dist, costa] = await tx
      .insert(schema.companies)
      .values([
        {
          slug: "distribuidora-parana",
          name: "Distribuidora Paraná",
          legalName: "Distribuidora Paraná SRL",
          cuit: formatStored(buildCuit("30", "71458901")),
          taxCondition: "ri",
          iibb: "3071458901",
          address: "Av. Almafuerte 1250",
          city: "Paraná",
          province: "Entre Ríos",
          postalCode: "3100",
          phone: "343 422-1800",
          email: "ventas@distribuidoraparana.demo",
          pointOfSale: 4,
          enabledModules: [
            "clientes",
            "proveedores",
            "articulos",
            "ventas",
            "compras",
            "pedidos",
            "remitos",
            "stock",
            "caja",
            "cuentas_corrientes",
            "contabilidad",
            "comprobantes",
            "auditoria",
            "informes",
          ],
          blockNegativeStock: true,
        },
        {
          slug: "costa-servicios",
          name: "Costa & Asociados",
          legalName: "Marina Costa",
          cuit: formatStored(buildCuit("27", "28445110")),
          taxCondition: "monotributo",
          address: "Buenos Aires 820",
          city: "Paraná",
          province: "Entre Ríos",
          postalCode: "3100",
          phone: "343 555-0142",
          email: "hola@costayasociados.demo",
          pointOfSale: 1,
          enabledModules: ["clientes", "articulos", "ventas", "caja", "cuentas_corrientes", "comprobantes", "auditoria", "informes"],
          blockNegativeStock: true,
        },
      ])
      .returning();

    const people = [
      ["laura@talon.demo", "Laura Benítez"],
      ["mateo@talon.demo", "Mateo Ruiz"],
      ["sofia@talon.demo", "Sofía Acosta"],
      ["julian@talon.demo", "Julián Pereyra"],
      ["carla@talon.demo", "Carla Domínguez"],
      ["hector@talon.demo", "Héctor Bianchi"],
      ["marina@talon.demo", "Marina Costa"],
    ] as const;
    const insertedUsers = await tx
      .insert(schema.users)
      .values(people.map(([email, name]) => ({ email, name, passwordHash })))
      .returning();
    const userByEmail = new Map(insertedUsers.map((user) => [user.email, user]));

    async function seedRoles(companyId: string) {
      const roleRows = await tx
        .insert(schema.roles)
        .values(
          Object.entries(ROLE_TEMPLATES).map(([key, role]) => ({
            companyId,
            key,
            name: role.name,
            description: role.description,
            isSystem: true,
          })),
        )
        .returning();
      await tx.insert(schema.rolePermissions).values(
        roleRows.flatMap((role) => ROLE_TEMPLATES[role.key].permissions.map((permission) => ({ roleId: role.id, permission }))),
      );
      return new Map(roleRows.map((role) => [role.key, role.id]));
    }

    const distRoles = await seedRoles(dist.id);
    const costaRoles = await seedRoles(costa.id);
    const laura = userByEmail.get("laura@talon.demo")!;
    await tx.insert(schema.memberships).values([
      { userId: laura.id, companyId: dist.id, roleId: distRoles.get("admin")! },
      { userId: laura.id, companyId: costa.id, roleId: costaRoles.get("admin")! },
      { userId: userByEmail.get("mateo@talon.demo")!.id, companyId: dist.id, roleId: distRoles.get("vendedor")! },
      { userId: userByEmail.get("sofia@talon.demo")!.id, companyId: dist.id, roleId: distRoles.get("cajero")! },
      { userId: userByEmail.get("julian@talon.demo")!.id, companyId: dist.id, roleId: distRoles.get("deposito")! },
      { userId: userByEmail.get("carla@talon.demo")!.id, companyId: dist.id, roleId: distRoles.get("compras")! },
      { userId: userByEmail.get("hector@talon.demo")!.id, companyId: dist.id, roleId: distRoles.get("contador")! },
      { userId: userByEmail.get("marina@talon.demo")!.id, companyId: costa.id, roleId: costaRoles.get("admin")! },
    ]);

    const rubros = await tx
      .insert(schema.categories)
      .values(
        ["Ferretería", "Electricidad", "Almacén", "Bebidas", "Limpieza"].map((name) => ({
          companyId: dist.id,
          kind: "articulo",
          name,
        })),
      )
      .returning();
    const rubroByName = new Map(rubros.map((row) => [row.name, row.id]));

    const lists = await tx
      .insert(schema.priceLists)
      .values([
        { companyId: dist.id, name: "Mostrador", isDefault: true },
        { companyId: dist.id, name: "Mayorista", isDefault: false },
        { companyId: dist.id, name: "Empleados", isDefault: false },
        { companyId: costa.id, name: "Honorarios", isDefault: true },
      ])
      .returning();
    const mostrador = lists.find((list) => list.name === "Mostrador")!;
    const mayorista = lists.find((list) => list.name === "Mayorista")!;
    const empleados = lists.find((list) => list.name === "Empleados")!;
    const honorarios = lists.find((list) => list.name === "Honorarios")!;

    const deps = await tx
      .insert(schema.warehouses)
      .values([
        { companyId: dist.id, name: "Depósito central", isDefault: true },
        { companyId: dist.id, name: "Depósito norte", isDefault: false },
      ])
      .returning();
    const central = deps.find((dep) => dep.isDefault)!;
    const norte = deps.find((dep) => !dep.isDefault)!;

    await tx.insert(schema.cashAccounts).values([
      { companyId: dist.id, name: "Caja mostrador", kind: "caja" },
      { companyId: dist.id, name: "Banco Credicoop", kind: "banco" },
      { companyId: costa.id, name: "Caja del estudio", kind: "caja" },
    ]);

    const ledger = [
      ["1", "Activo", null, false, "activo"],
      ["1.1.01", "Caja", "1", true, "activo"],
      ["1.1.02", "Bancos", "1", true, "activo"],
      ["1.1.03", "Deudores por ventas", "1", true, "activo"],
      ["1.1.04", "IVA crédito fiscal", "1", true, "activo"],
      ["1.1.05", "Mercaderías", "1", true, "activo"],
      ["2", "Pasivo", null, false, "pasivo"],
      ["2.1.01", "Proveedores", "2", true, "pasivo"],
      ["2.1.02", "IVA débito fiscal", "2", true, "pasivo"],
      ["3", "Patrimonio neto", null, false, "patrimonio"],
      ["3.1.01", "Capital", "3", true, "patrimonio"],
      ["4", "Ingresos", null, false, "ingreso"],
      ["4.1.01", "Ventas", "4", true, "ingreso"],
      ["5", "Egresos", null, false, "egreso"],
      ["5.1.01", "Costo de mercadería", "5", true, "egreso"],
      ["5.2.01", "Alquileres", "5", true, "egreso"],
    ] as const;
    await tx.insert(schema.ledgerAccounts).values(
      ledger.map(([code, name, parentCode, imputable, kind]) => ({
        companyId: dist.id,
        code,
        name,
        parentCode,
        imputable,
        kind,
      })),
    );

    const typeSeed = [
      ["FAC", "Factura A/B/C", "venta", 1, true, -1, true, "debit", true, "in", true, { A: 1, B: 6, C: 11 }],
      ["NCR", "Nota de crédito", "venta", -1, true, 1, true, "credit", true, "out", true, { A: 3, B: 8, C: 13 }],
      ["ND", "Nota de débito", "venta", 1, false, 0, true, "debit", false, null, true, { A: 2, B: 7, C: 12 }],
      ["PED", "Pedido", "pedido", 1, false, 0, false, null, false, null, false, {}],
      ["REM", "Remito", "remito", 1, true, -1, false, null, false, null, false, {}],
      ["REC", "Recibo", "venta", -1, false, 0, true, "credit", true, "in", false, {}],
      ["FCP", "Factura de compra", "compra", 1, true, 1, true, "credit", true, "out", true, { A: 1, B: 6, C: 11 }],
      ["NCC", "Nota de crédito de compra", "compra", -1, true, -1, true, "debit", true, "in", true, { A: 3, B: 8, C: 13 }],
    ] as const;
    const distTypes = await tx
      .insert(schema.documentTypes)
      .values(
        typeSeed.map(([code, name, kind, sign, movesStock, stockFactor, movesAccount, accountSide, movesCash, cashDirection, movesVat, afipCodes]) => ({
          companyId: dist.id,
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
          nextNumber: 1,
        })),
      )
      .returning();
    const typeByCode = new Map(distTypes.map((row) => [row.code, row]));

    await tx.insert(schema.documentTypes).values([
      {
        companyId: costa.id,
        code: "FAC",
        name: "Factura",
        kind: "venta",
        sign: 1,
        movesStock: false,
        stockFactor: 0,
        movesAccount: true,
        accountSide: "debit",
        movesCash: true,
        cashDirection: "in",
        movesVat: true,
        afipCodes: { C: 11 },
        nextNumber: 1,
      },
      {
        companyId: costa.id,
        code: "NCR",
        name: "Nota de crédito",
        kind: "venta",
        sign: -1,
        movesStock: false,
        stockFactor: 0,
        movesAccount: true,
        accountSide: "credit",
        movesCash: true,
        cashDirection: "out",
        movesVat: true,
        afipCodes: { C: 13 },
        nextNumber: 1,
      },
      {
        companyId: costa.id,
        code: "ND",
        name: "Nota de débito",
        kind: "venta",
        sign: 1,
        movesStock: false,
        stockFactor: 0,
        movesAccount: true,
        accountSide: "debit",
        movesCash: false,
        cashDirection: null,
        movesVat: true,
        afipCodes: { C: 12 },
        nextNumber: 1,
      },
      {
        companyId: costa.id,
        code: "FCP",
        name: "Factura de compra",
        kind: "compra",
        sign: 1,
        movesStock: true,
        stockFactor: 1,
        movesAccount: true,
        accountSide: "credit",
        movesCash: true,
        cashDirection: "out",
        movesVat: true,
        afipCodes: { C: 11 },
        nextNumber: 1,
      },
      {
        companyId: costa.id,
        code: "REM",
        name: "Remito",
        kind: "remito",
        sign: 1,
        movesStock: true,
        stockFactor: -1,
        movesAccount: false,
        accountSide: null,
        movesCash: false,
        cashDirection: null,
        movesVat: false,
        afipCodes: {},
        nextNumber: 1,
      },
      {
        companyId: costa.id,
        code: "REC",
        name: "Recibo",
        kind: "venta",
        sign: -1,
        movesStock: false,
        stockFactor: 0,
        movesAccount: true,
        accountSide: "credit",
        movesCash: true,
        cashDirection: "in",
        movesVat: false,
        afipCodes: {},
        nextNumber: 1,
      },
    ]);

    const [reparto, gondola] = await tx
      .insert(schema.customFieldDefs)
      .values([
        { companyId: dist.id, entity: "cliente", key: "horario_reparto", label: "Horario de reparto", fieldType: "text", position: 1 },
        { companyId: dist.id, entity: "articulo", key: "gondola", label: "Ubicación en depósito", fieldType: "text", position: 1 },
      ])
      .returning();

    const supplierNames = ["Ferretera del Litoral SA", "Alimentos Río SA", "Bebidas Austro SRL", "Limpieza Pampa", "Cables del Norte SA"];
    const supplierRows = await tx
      .insert(schema.suppliers)
      .values(
        supplierNames.map((name, index) => ({
          companyId: dist.id,
          code: `P${String(index + 1).padStart(4, "0")}`,
          name,
          cuit: formatStored(buildCuit("30", String(51000000 + index * 137).slice(0, 8))),
          taxCondition: index === 3 ? "monotributo" : "ri",
          city: index % 2 === 0 ? "Paraná" : "Santa Fe",
          province: index % 2 === 0 ? "Entre Ríos" : "Santa Fe",
          paymentTermsDays: 15,
        })),
      )
      .returning();

    const localidades = [
      ["Paraná", "Entre Ríos"],
      ["Santa Fe", "Santa Fe"],
      ["Concordia", "Entre Ríos"],
      ["Gualeguaychú", "Entre Ríos"],
      ["Victoria", "Entre Ríos"],
      ["Rosario", "Santa Fe"],
      ["Crespo", "Entre Ríos"],
    ] as const;
    const condiciones = ["ri", "ri", "monotributo", "cf", "exento"] as const;
    const comercios = ["Kiosco", "Despensa", "Ferretería", "Super", "Bar", "Almacén", "Dietética"];
    const customerRows = await tx
      .insert(schema.customers)
      .values(
        Array.from({ length: 36 }, (_, index) => {
          const [city, province] = localidades[index % localidades.length];
          const taxCondition = condiciones[index % condiciones.length];
          const cuit = taxCondition === "cf" ? null : formatStored(buildCuit(taxCondition === "monotributo" ? "20" : "30", String(60000000 + index * 97).padStart(8, "0").slice(0, 8)));
          return {
            companyId: dist.id,
            code: `C${String(index + 1).padStart(4, "0")}`,
            name: `${comercios[index % comercios.length]} ${city} ${index + 1}${index === 0 || index === 1 ? " · DEMO IIBB 3%" : ""}`,
            fantasyName: index % 3 === 0 ? `Sucursal ${index + 1}` : null,
            docType: taxCondition === "cf" ? "DNI" : "CUIT",
            cuit,
            taxCondition,
            city,
            province,
            priceListId: index % 4 === 0 ? mayorista.id : mostrador.id,
            discountBps: index % 5 === 0 ? 500 : 0,
            creditLimitCents: taxCondition === "cf" ? 0 : 250_000_00,
            iibbPerceptionBps: index === 0 || index === 1 ? 300 : null,
            paymentTermsDays: 7,
            zone: city,
          };
        }),
      )
      .returning();

    await tx.insert(schema.customFieldValues).values(
      customerRows.slice(0, 8).map((customer, index) => ({
        companyId: dist.id,
        fieldId: reparto.id,
        recordId: customer.id,
        value: index % 2 === 0 ? "Mañana, antes de las 11" : "Tarde, después de las 15",
      })),
    );

    const families = [
      { cat: "Ferretería", names: ["Tornillo autoperforante", "Tuerca hexagonal", "Arandela plana", "Tarugo de nylon", "Candado", "Bisagra"], unit: "u" },
      { cat: "Electricidad", names: ["Cable unipolar", "Tomacorriente", "Llave de luz", "Cinta aisladora", "Termomagnética"], unit: "u" },
      { cat: "Almacén", names: ["Yerba mate", "Azúcar", "Arroz largo", "Fideos", "Aceite de girasol", "Harina 000"], unit: "u" },
      { cat: "Bebidas", names: ["Gaseosa cola", "Agua mineral", "Vino tinto", "Cerveza lager"], unit: "u" },
      { cat: "Limpieza", names: ["Lavandina", "Detergente", "Jabón en polvo", "Bolsas de residuo"], unit: "u" },
    ];
    const sizes = ["chico", "mediano", "grande", "x 6", "x 12", "1 kg", "5 kg", "8 mm", "10 mm", "2,5 mm", "4 mm"];
    const marcas = ["Litoral", "Del Puerto", "Pampa", "Oficio"];
    const productValues = [];
    let sku = 1;
    for (const family of families) {
      for (const name of family.names) {
        for (const size of sizes) {
          for (const marca of marcas) {
            if (productValues.length >= 720) break;
            const cost = 80_00 + Math.floor(rand() * 420_00);
            const low = sku % 17 === 0;
            productValues.push({
              companyId: dist.id,
              sku: `ART-${String(sku).padStart(5, "0")}`,
              name: `${name} ${size} ${marca}`,
              categoryId: rubroByName.get(family.cat)!,
              unit: family.unit,
              ivaRateBps: family.cat === "Almacén" && size.includes("kg") ? 1050 : 2100,
              taxTreatment: "gravado",
              tracksStock: true,
              costCents: cost,
              minStock: low ? 180 : 12,
              supplierId: supplierRows[sku % supplierRows.length].id,
              barcode: `779${String(1000000 + sku)}`,
            });
            sku += 1;
          }
        }
      }
    }
    const productRows = await tx.insert(schema.products).values(productValues).returning({ id: schema.products.id, costCents: schema.products.costCents, minStock: schema.products.minStock });
    await tx.insert(schema.productPrices).values(
      productRows.flatMap((product) => [
        { productId: product.id, priceListId: mostrador.id, companyId: dist.id, priceCents: Math.round(product.costCents * 1.55) },
        { productId: product.id, priceListId: mayorista.id, companyId: dist.id, priceCents: Math.round(product.costCents * 1.32) },
        { productId: product.id, priceListId: empleados.id, companyId: dist.id, priceCents: Math.round(product.costCents * 1.18) },
      ]),
    );
    await tx.insert(schema.stockLevels).values(
      productRows.flatMap((product, index) => {
        const low = Number(product.minStock) > 50;
        const base = low ? 40 : 90 + (index % 80);
        return [
          { productId: product.id, warehouseId: central.id, companyId: dist.id, quantity: base },
          { productId: product.id, warehouseId: norte.id, companyId: dist.id, quantity: Math.round(base / 3) },
        ];
      }),
    );
    await tx.insert(schema.customFieldValues).values(
      productRows.slice(0, 12).map((product, index) => ({
        companyId: dist.id,
        fieldId: gondola.id,
        recordId: product.id,
        value: `Pasillo ${1 + (index % 4)}, estante ${index + 1}`,
      })),
    );

    const actor = laura.id;
    for (let index = 0; index < 48; index += 1) {
      const customer = pick(rand, customerRows);
      const lines = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
        productId: pick(rand, productRows).id,
        quantity: 1 + Math.floor(rand() * 6),
      }));
      await createDocument(tx as never, { userId: actor, companyId: dist.id }, {
        kind: "venta",
        documentTypeId: typeByCode.get("FAC")!.id,
        partyId: customer.id,
        issuedOn: daysAgo(rand, 40),
        paymentMethod: rand() > 0.35 ? "cuenta_corriente" : "contado",
        warehouseId: rand() > 0.25 ? central.id : norte.id,
        lines,
        acknowledgeCredit: true,
      });
    }
    for (let index = 0; index < 14; index += 1) {
      await createDocument(tx as never, { userId: actor, companyId: dist.id }, {
        kind: "compra",
        documentTypeId: typeByCode.get("FCP")!.id,
        partyId: pick(rand, supplierRows).id,
        issuedOn: daysAgo(rand, 40),
        paymentMethod: rand() > 0.5 ? "cuenta_corriente" : "contado",
        warehouseId: central.id,
        lines: [{ productId: pick(rand, productRows).id, quantity: 10 + Math.floor(rand() * 20) }],
      });
    }
    for (let index = 0; index < 10; index += 1) {
      await createDocument(tx as never, { userId: actor, companyId: dist.id }, {
        kind: "pedido",
        documentTypeId: typeByCode.get("PED")!.id,
        partyId: pick(rand, customerRows).id,
        issuedOn: daysAgo(rand, 15),
        lines: [{ productId: pick(rand, productRows).id, quantity: 2 + Math.floor(rand() * 4) }],
      });
    }
    for (let index = 0; index < 8; index += 1) {
      await createDocument(tx as never, { userId: actor, companyId: dist.id }, {
        kind: "remito",
        documentTypeId: typeByCode.get("REM")!.id,
        partyId: pick(rand, customerRows).id,
        issuedOn: daysAgo(rand, 20),
        warehouseId: central.id,
        lines: [{ productId: pick(rand, productRows).id, quantity: 1 + Math.floor(rand() * 3) }],
      });
    }

    const costaCustomers = await tx
      .insert(schema.customers)
      .values([
        { companyId: costa.id, code: "C0001", name: "Taller Norte SRL", cuit: formatStored(buildCuit("30", "69881234")), taxCondition: "ri", city: "Paraná", province: "Entre Ríos" },
        { companyId: costa.id, code: "C0002", name: "Panadería La Esquina", cuit: formatStored(buildCuit("20", "30111999")), taxCondition: "monotributo", city: "Paraná", province: "Entre Ríos" },
        { companyId: costa.id, code: "C0003", name: "Consumidor mostrador", docType: "DNI", cuit: "30111222", taxCondition: "cf", city: "Paraná", province: "Entre Ríos" },
      ])
      .returning();
    const costaProducts = await tx
      .insert(schema.products)
      .values([
        { companyId: costa.id, sku: "SRV-001", name: "Liquidación de IVA", ivaRateBps: 0, taxTreatment: "no_gravado", tracksStock: false, costCents: 0 },
        { companyId: costa.id, sku: "SRV-002", name: "Liquidación de sueldos", ivaRateBps: 0, taxTreatment: "no_gravado", tracksStock: false, costCents: 0 },
        { companyId: costa.id, sku: "SRV-003", name: "Asesoramiento impositivo", ivaRateBps: 0, taxTreatment: "no_gravado", tracksStock: false, costCents: 0 },
      ])
      .returning();
    await tx.insert(schema.productPrices).values(
      costaProducts.map((product, index) => ({
        productId: product.id,
        priceListId: honorarios.id,
        companyId: costa.id,
        priceCents: [45_000_00, 38_000_00, 25_000_00][index],
      })),
    );
    const costaFac = await tx.select().from(schema.documentTypes).where(eq(schema.documentTypes.companyId, costa.id));
    const costaFactura = costaFac.find((row) => row.code === "FAC")!;
    for (const customer of costaCustomers.slice(0, 2)) {
      await createDocument(tx as never, { userId: userByEmail.get("marina@talon.demo")!.id, companyId: costa.id }, {
        kind: "venta",
        documentTypeId: costaFactura.id,
        partyId: customer.id,
        issuedOn: daysAgo(rand, 20),
        paymentMethod: "cuenta_corriente",
        lines: [{ productId: costaProducts[0].id, quantity: 1, unitPriceCents: 45_000_00 }],
      });
    }

    await tx.insert(schema.auditLog).values({
      companyId: dist.id,
      userId: actor,
      action: "sistema.seed",
      entity: "empresa",
      entityId: dist.id,
      summary: "Carga inicial de la empresa demo",
    });
  });

  await seedStation(sql);
  await syncSystemRoles(sql);
  await seedInmobiliaria(sql);
  await seedConstructora(sql);
  await simplifyDemoPerceptions(sql);
  // Hook del instalador: TALON_MODO=estudio deja todas las empresas en modo estudio.
  if (process.env.TALON_MODO?.trim()) {
    const mode = defaultCompanyMode();
    await applyCompanyMode(sql, mode, "todas");
    console.log(`TALON_MODO=${mode} aplicado a todas las empresas`);
  }
  await sql`analyze`;
  await sql.end();
  console.log("Seed listo. Entrá con laura@talon.demo / talon1234");
}

function formatStored(cuit: string): string {
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
