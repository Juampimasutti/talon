import type postgres from "postgres";
import { hashPassword } from "../src/lib/auth/password";
import { ROLE_TEMPLATES } from "../src/lib/auth/permissions";
import { buildCuit } from "../src/lib/fiscal/cuit";

export async function seedStation(sql: postgres.Sql) {
  const existing = await sql<{ id: string }[]>`select id from companies where slug = 'estacion-almafuerte'`;
  if (existing.length > 0) {
    console.log("La estación demo ya está cargada");
    await ensureStationExtras(sql);
    return;
  }
  const passwordHash = hashPassword("talon1234");
  const cuit = buildCuit("30", "50999111");
  const formatted = `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
  const fleetCuit = buildCuit("30", "68881234");
  const fleetFormatted = `${fleetCuit.slice(0, 2)}-${fleetCuit.slice(2, 10)}-${fleetCuit.slice(10)}`;

  await sql.begin(async (tx) => {
    const [company] = await tx<{ id: string }[]>`
      insert into companies (slug, name, legal_name, cuit, tax_condition, address, city, province, postal_code, phone, email, point_of_sale, enabled_modules)
      values (
        'estacion-almafuerte', 'Estación Almafuerte', 'Estación Almafuerte SRL', ${formatted}, 'ri',
        'Av. Almafuerte 2100', 'Paraná', 'Entre Ríos', '3100', '343 422-9000', 'playa@almafuerte.demo', 2,
        ${tx.array(["estacion", "clientes", "articulos", "ventas", "caja", "cuentas_corrientes", "comprobantes", "proveedores", "auditoria", "informes", "reparto", "remitos", "stock"])}
      ) returning id
    `;
    const roleIds = new Map<string, string>();
    for (const [key, role] of Object.entries(ROLE_TEMPLATES)) {
      const [created] = await tx<{ id: string }[]>`
        insert into roles (company_id, key, name, description, is_system)
        values (${company.id}, ${key}, ${role.name}, ${role.description}, true)
        returning id
      `;
      roleIds.set(key, created.id);
      if (role.permissions.length) {
        await tx`insert into role_permissions ${tx(
          role.permissions.map((permission) => ({ role_id: created.id, permission })),
          "role_id",
          "permission",
        )}`;
      }
    }
    async function ensureUser(email: string, name: string, roleKey: string) {
      const found = await tx<{ id: string }[]>`select id from users where email = ${email}`;
      const userId = found[0]?.id ?? (await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${email}, ${name}, ${passwordHash}) returning id`)[0].id;
      await tx`insert into memberships (user_id, company_id, role_id) values (${userId}, ${company.id}, ${roleIds.get(roleKey)!}) on conflict do nothing`;
      return userId;
    }
    const laura = await ensureUser("laura@talon.demo", "Laura Benítez", "admin");
    const ramiro = await ensureUser("ramiro@talon.demo", "Ramiro Páez", "encargado");
    const luciana = await ensureUser("luciana@talon.demo", "Luciana Ferreyra", "playero");
    await tx`
      insert into document_types (company_id, code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
      values (${company.id}, 'FAC', 'Factura', 'venta', 1, true, -1, true, 'debit', true, 'in', true, '{"A":1,"B":6,"C":11}'::jsonb)
    `;
    const products = [
      ["NS", "Nafta súper", "litro", 120_000, 15_000, 2_500],
      ["NP", "Nafta premium", "litro", 145_000, 15_000, 2_500],
      ["GO", "Gasoil grado 2", "litro", 118_000, 12_000, 2_200],
      ["GNC", "GNC", "m3", 450_00, 0, 0],
    ] as const;
    const productIds = new Map<string, string>();
    for (const [code, name, unit, price, itc, co2] of products) {
      const [product] = await tx<{ id: string }[]>`
        insert into fuel_products (company_id, code, name, unit) values (${company.id}, ${code}, ${name}, ${unit}) returning id
      `;
      productIds.set(code, product.id);
      await tx`insert into fuel_prices (company_id, product_id, cents_per_unit, valid_from) values (${company.id}, ${product.id}, ${price}, '2026-10-01T00:00:00Z')`;
      if (itc) {
        await tx`insert into fuel_taxes (company_id, product_id, code, name, cents_per_unit, treatment, in_vat_base, valid_from) values (${company.id}, ${product.id}, 'itc', 'ITC', ${itc}, 'interno', false, '2026-10-01')`;
      }
      if (co2) {
        await tx`insert into fuel_taxes (company_id, product_id, code, name, cents_per_unit, treatment, in_vat_base, valid_from) values (${company.id}, ${product.id}, 'co2', 'Impuesto al CO2', ${co2}, 'no_gravado', false, '2026-10-01')`;
      }
    }
    const tank = async (name: string, code: string, capacity: number) => {
      const [row] = await tx<{ id: string }[]>`insert into fuel_tanks (company_id, product_id, name, capacity) values (${company.id}, ${productIds.get(code)!}, ${name}, ${capacity}) returning id`;
      return row.id;
    };
    const tankSuper = await tank("Tanque súper", "NS", 30000);
    const tankPremium = await tank("Tanque premium", "NP", 15000);
    const tankGasoil = await tank("Tanque gasoil", "GO", 20000);
    const tankGnc = await tank("Tanque GNC", "GNC", 8000);
    const [pump] = await tx<{ id: string }[]>`insert into fuel_pumps (company_id, name, number) values (${company.id}, 'Isla 1', 1) returning id`;
    const nozzles = [
      [1, "NS", tankSuper],
      [2, "NP", tankPremium],
      [3, "GO", tankGasoil],
      [4, "GNC", tankGnc],
    ] as const;
    const nozzleIds: string[] = [];
    for (const [number, code, tankId] of nozzles) {
      const [nozzle] = await tx<{ id: string }[]>`
        insert into fuel_nozzles (company_id, pump_id, tank_id, product_id, number)
        values (${company.id}, ${pump.id}, ${tankId}, ${productIds.get(code)!}, ${number}) returning id
      `;
      nozzleIds.push(nozzle.id);
    }
    const [shift] = await tx<{ id: string }[]>`
      insert into fuel_shifts (company_id, attendant_id, attendant_name, opened_at, closed_at, status, invoiced_cents)
      values (${company.id}, ${luciana}, 'Luciana Ferreyra', now() - interval '1 day', now() - interval '12 hours', 'cerrado', 24000000)
      returning id
    `;
    await tx`
      insert into fuel_readings (company_id, shift_id, nozzle_id, opening, closing, liters, price_cents, amount_cents)
      values
        (${company.id}, ${shift.id}, ${nozzleIds[0]}, 10234.5, 10434.8, 200.3, 120000, 24036000),
        (${company.id}, ${shift.id}, ${nozzleIds[2]}, 8000, 8150, 150, 118000, 17700000)
    `;
    await tx`
      insert into fuel_payments (company_id, shift_id, method, amount_cents) values
        (${company.id}, ${shift.id}, 'efectivo', 20000000),
        (${company.id}, ${shift.id}, 'tarjeta', 15000000),
        (${company.id}, ${shift.id}, 'qr', 5000000),
        (${company.id}, ${shift.id}, 'cuenta_corriente', 1736000)
    `;
    await tx`insert into fuel_shop_lines (company_id, shift_id, description, quantity, amount_cents) values (${company.id}, ${shift.id}, 'Aceite 15W40', 1, 1800000)`;
    await tx`insert into fuel_sticks (company_id, tank_id, measured_at, liters, note, user_id) values
      (${company.id}, ${tankSuper}, now() - interval '2 days', 10000, 'Varilla anterior', ${ramiro}),
      (${company.id}, ${tankSuper}, now() - interval '1 hour', 14790, 'Varilla de hoy', ${ramiro})
    `;
    await tx`insert into fuel_deliveries (company_id, tank_id, supplier_name, delivered_at, liters, remito) values (${company.id}, ${tankSuper}, 'Combustibles del Litoral', now() - interval '30 hours', 5000, 'R-000123')`;
    const [customer] = await tx<{ id: string }[]>`
      insert into customers (company_id, code, name, cuit, tax_condition, city, province)
      values (${company.id}, 'C0001', 'Transportes del Litoral SA', ${fleetFormatted}, 'ri', 'Paraná', 'Entre Ríos')
      returning id
    `;
    const [vehicle] = await tx<{ id: string }[]>`
      insert into fleet_vehicles (company_id, customer_id, plate, description, limit_cents)
      values (${company.id}, ${customer.id}, 'AE123BC', 'Camión atego', 50000000) returning id
    `;
    const [driver] = await tx<{ id: string }[]>`
      insert into fleet_drivers (company_id, customer_id, name, document)
      values (${company.id}, ${customer.id}, 'Pedro Alegre', '30111222') returning id
    `;
    await tx`
      insert into fleet_vouchers (company_id, customer_id, vehicle_id, driver_id, product_id, liters, amount_cents, issued_on)
      values (${company.id}, ${customer.id}, ${vehicle.id}, ${driver.id}, ${productIds.get("NS")!}, 40, ${40 * 120_000}, current_date)
    `;
    const [warehouse] = await tx<{ id: string }[]>`insert into warehouses (company_id, name, is_default) values (${company.id}, 'Shop', true) returning id`;
    const [priceList] = await tx<{ id: string }[]>`insert into price_lists (company_id, name, is_default) values (${company.id}, 'Shop', true) returning id`;
    const shopItems = [
      ["SHOP-ACEITE", "Aceite 15W40", true, 1_200_000, 1_800_000, 24],
      ["SHOP-CAFE", "Café de máquina", false, 80_000, 250_000, 0],
    ] as const;
    for (const [sku, name, tracks, cost, price, stock] of shopItems) {
      const [product] = await tx<{ id: string }[]>`
        insert into products (company_id, sku, name, unit, iva_rate_bps, tracks_stock, cost_cents)
        values (${company.id}, ${sku}, ${name}, 'u', 2100, ${tracks}, ${cost})
        returning id
      `;
      await tx`insert into product_prices (product_id, price_list_id, company_id, price_cents) values (${product.id}, ${priceList.id}, ${company.id}, ${price})`;
      if (tracks) {
        await tx`insert into stock_levels (product_id, warehouse_id, company_id, quantity) values (${product.id}, ${warehouse.id}, ${company.id}, ${stock})`;
      }
    }
    await tx`insert into audit_log (company_id, user_id, action, entity, entity_id, summary) values (${company.id}, ${laura}, 'sistema.seed', 'empresa', ${company.id}, 'Carga inicial de la estación')`;
  });
  await ensureStationExtras(sql);
  console.log("Estación Almafuerte lista. Playera: luciana@talon.demo. Encargado: ramiro@talon.demo. Chofer: oscar@talon.demo");
}

async function ensureStationExtras(sql: postgres.Sql) {
  const [company] = await sql<{ id: string }[]>`select id from companies where slug = 'estacion-almafuerte'`;
  if (!company) return;
  await sql`
    update companies
    set enabled_modules = (
      select array_agg(distinct m) from unnest(enabled_modules || array['compras','stock','contabilidad','reparto','informes','remitos']) as m
    )
    where id = ${company.id}
  `;
  await sql`
    update companies
    set enabled_modules = (
      select array_agg(distinct m) from unnest(enabled_modules || array['remitos']) as m
    )
    where id = ${company.id}
  `;
  const passwordHash = hashPassword("talon1234");
  let [role] = await sql<{ id: string }[]>`select id from roles where company_id = ${company.id} and key = 'chofer'`;
  if (!role) {
    [role] = await sql<{ id: string }[]>`
      insert into roles (company_id, key, name, description, is_system)
      values (${company.id}, 'chofer', ${ROLE_TEMPLATES.chofer.name}, ${ROLE_TEMPLATES.chofer.description}, true)
      returning id
    `;
  }
  const [oscar] = await sql<{ id: string }[]>`select id from users where email = 'oscar@talon.demo'`;
  const oscarId = oscar?.id ?? (await sql<{ id: string }[]>`insert into users (email, name, password_hash) values ('oscar@talon.demo', 'Oscar Luna', ${passwordHash}) returning id`)[0].id;
  await sql`insert into memberships (user_id, company_id, role_id) values (${oscarId}, ${company.id}, ${role.id}) on conflict do nothing`;
  await sql`
    insert into document_types (company_id, code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
    select ${company.id}, t.code, t.name, t.kind, t.sign, t.moves_stock, t.stock_factor, t.moves_account, t.account_side, t.moves_cash, t.cash_direction, t.moves_vat, t.afip_codes::jsonb
    from (values
      ('FAC', 'Factura A/B/C', 'venta', 1, true, -1, true, 'debit', true, 'in', true, '{"A":1,"B":6,"C":11}'),
      ('NCR', 'Nota de crédito', 'venta', -1, true, 1, true, 'credit', true, 'out', true, '{"A":3,"B":8,"C":13}'),
      ('ND', 'Nota de débito', 'venta', 1, false, 0, true, 'debit', false, null, true, '{"A":2,"B":7,"C":12}'),
      ('FCP', 'Factura de compra', 'compra', 1, true, 1, true, 'credit', true, 'out', true, '{"A":1,"B":6,"C":11}'),
      ('REM', 'Remito', 'remito', 1, true, -1, false, null, false, null, false, '{}'),
      ('REC', 'Recibo', 'venta', -1, false, 0, true, 'credit', true, 'in', false, '{}')
    ) as t(code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
    where not exists (select 1 from document_types d where d.company_id = ${company.id} and d.code = t.code)
  `;
  const accounts = await sql`select 1 from ledger_accounts where company_id = ${company.id} limit 1`;
  if (accounts.length === 0) {
    await sql`insert into ledger_accounts (company_id, code, name, parent_code, imputable, kind) values
      (${company.id}, '1', 'Activo', null, false, 'activo'),
      (${company.id}, '1.1.01', 'Caja', '1', true, 'activo'),
      (${company.id}, '1.1.04', 'Combustibles', '1', true, 'activo')`;
  }
  const caja = await sql`select 1 from cash_accounts where company_id = ${company.id} limit 1`;
  if (caja.length === 0) {
    await sql`insert into cash_accounts (company_id, name, kind, active) values (${company.id}, 'Caja', 'caja', true)`;
  }
  const suppliers = await sql`select 1 from suppliers where company_id = ${company.id} limit 1`;
  if (suppliers.length === 0) {
    await sql`insert into suppliers (company_id, code, name, cuit, tax_condition, city, province) values (${company.id}, 'P0001', 'Combustibles del Litoral', '30-71234567-1', 'ri', 'Paraná', 'Entre Ríos')`;
  }
  const trucks = await sql`select 1 from fuel_trucks where company_id = ${company.id} limit 1`;
  if (trucks.length > 0) return;
  const products = await sql<{ id: string; code: string }[]>`select id::text, code from fuel_products where company_id = ${company.id}`;
  const byCode = new Map(products.map((product) => [product.code, product.id]));
  const [tank] = await sql<{ id: string }[]>`select id::text from fuel_tanks where company_id = ${company.id} and name = 'Tanque súper'`;
  const fleet = [
    ["AE100AA", "Cisterna norte", [["1", "NS", 8000], ["2", "GO", 8000]]],
    ["AE200BB", "Cisterna sur", [["1", "GO", 12000]]],
    ["AE300CC", "Cisterna premium", [["1", "NP", 6000]]],
  ] as const;
  let firstTruck = "";
  let superCompartment = "";
  for (const [plate, name, compartments] of fleet) {
    const [truck] = await sql<{ id: string }[]>`insert into fuel_trucks (company_id, plate, name) values (${company.id}, ${plate}, ${name}) returning id`;
    if (!firstTruck) firstTruck = truck.id;
    for (const [label, code, capacity] of compartments) {
      const [compartment] = await sql<{ id: string }[]>`
        insert into fuel_compartments (company_id, truck_id, product_id, name, capacity)
        values (${company.id}, ${truck.id}, ${byCode.get(code)!}, ${label}, ${capacity})
        returning id
      `;
      if (code === "NS" && !superCompartment) superCompartment = compartment.id;
    }
  }
  if (!tank || !superCompartment) return;
  const [trip] = await sql<{ id: string }[]>`
    insert into fuel_trips (company_id, truck_id, driver_user_id, driver_name, km_start)
    values (${company.id}, ${firstTruck}, ${oscarId}, 'Oscar Luna', 120340)
    returning id
  `;
  await sql`update fuel_compartments set quantity = 1500 where id = ${superCompartment}`;
  await sql`
    insert into fuel_trip_events (company_id, trip_id, kind, tank_id, compartment_id, liters)
    values (${company.id}, ${trip.id}, 'carga', ${tank.id}, ${superCompartment}, 1500)
  `;
  await sql`
    insert into fuel_trip_events (company_id, trip_id, kind, amount_cents, note)
    values (${company.id}, ${trip.id}, 'gasto', 850000, 'Peaje')
  `;
}
