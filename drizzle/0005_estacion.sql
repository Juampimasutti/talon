CREATE TABLE fuel_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'litro',
  iva_rate_bps integer NOT NULL DEFAULT 2100,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE fuel_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES fuel_products (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  cents_per_unit bigint NOT NULL,
  treatment text NOT NULL,
  in_vat_base boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fuel_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES fuel_products (id) ON DELETE CASCADE,
  cents_per_unit bigint NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fuel_tanks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES fuel_products (id),
  name text NOT NULL,
  capacity numeric(14, 3) NOT NULL
);

CREATE TABLE fuel_pumps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name text NOT NULL
);

CREATE TABLE fuel_nozzles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  pump_id uuid NOT NULL REFERENCES fuel_pumps (id) ON DELETE CASCADE,
  tank_id uuid NOT NULL REFERENCES fuel_tanks (id),
  product_id uuid NOT NULL REFERENCES fuel_products (id),
  number integer NOT NULL
);

CREATE TABLE fuel_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  attendant_id uuid,
  attendant_name text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  status text NOT NULL DEFAULT 'abierto',
  invoiced_cents bigint NOT NULL DEFAULT 0,
  notes text
);

CREATE TABLE fuel_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES fuel_shifts (id) ON DELETE CASCADE,
  nozzle_id uuid NOT NULL REFERENCES fuel_nozzles (id),
  opening numeric(14, 3) NOT NULL,
  closing numeric(14, 3),
  liters numeric(14, 3) NOT NULL DEFAULT 0,
  price_cents bigint NOT NULL DEFAULT 0,
  amount_cents bigint NOT NULL DEFAULT 0
);

CREATE TABLE fuel_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES fuel_shifts (id) ON DELETE CASCADE,
  method text NOT NULL,
  amount_cents bigint NOT NULL,
  note text
);

CREATE TABLE fuel_shop_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES fuel_shifts (id) ON DELETE CASCADE,
  product_id uuid,
  description text NOT NULL,
  quantity numeric(14, 3) NOT NULL,
  amount_cents bigint NOT NULL
);

CREATE TABLE fuel_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  tank_id uuid NOT NULL REFERENCES fuel_tanks (id),
  supplier_name text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  liters numeric(14, 3) NOT NULL,
  remito text
);

CREATE TABLE fuel_sticks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  tank_id uuid NOT NULL REFERENCES fuel_tanks (id),
  measured_at timestamptz NOT NULL DEFAULT now(),
  liters numeric(14, 3) NOT NULL,
  note text,
  user_id uuid
);

CREATE TABLE fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers (id),
  plate text NOT NULL,
  description text,
  limit_cents bigint,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE fleet_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers (id),
  name text NOT NULL,
  document text,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE fleet_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers (id),
  vehicle_id uuid REFERENCES fleet_vehicles (id),
  driver_id uuid REFERENCES fleet_drivers (id),
  shift_id uuid REFERENCES fuel_shifts (id),
  product_id uuid NOT NULL REFERENCES fuel_products (id),
  liters numeric(14, 3) NOT NULL,
  amount_cents bigint NOT NULL,
  issued_on date NOT NULL,
  status text NOT NULL DEFAULT 'abierto',
  document_id uuid
);

CREATE INDEX fuel_prices_product_idx ON fuel_prices (product_id, valid_from DESC);
CREATE INDEX fuel_readings_shift_idx ON fuel_readings (shift_id);
CREATE INDEX fuel_shifts_company_idx ON fuel_shifts (company_id, opened_at DESC);
CREATE INDEX fleet_vouchers_customer_idx ON fleet_vouchers (company_id, customer_id, status);

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
    'fuel_products','fuel_taxes','fuel_prices','fuel_tanks','fuel_pumps','fuel_nozzles',
    'fuel_shifts','fuel_readings','fuel_payments','fuel_shop_lines','fuel_deliveries',
    'fuel_sticks','fleet_vehicles','fleet_drivers','fleet_vouchers'
  ]) AS tbl
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (company_id = app_company_id() AND app_has_permission(''estacion.ver''))',
      r.tbl || '_select', r.tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (company_id = app_company_id() AND (app_has_permission(''estacion.crear'') OR app_has_permission(''estacion.editar'')))',
      r.tbl || '_insert', r.tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (company_id = app_company_id() AND (app_has_permission(''estacion.crear'') OR app_has_permission(''estacion.editar''))) WITH CHECK (company_id = app_company_id())',
      r.tbl || '_update', r.tbl
    );
  END LOOP;
END $$;

-- El shop descuenta artículos existentes. El playero no tiene stock.ver:
-- estas políticas se suman (OR) a las de ventas y depósito.
CREATE POLICY stock_levels_estacion_select ON stock_levels FOR SELECT
  USING (company_id = app_company_id() AND app_has_permission('estacion.crear'));
CREATE POLICY stock_levels_estacion_insert ON stock_levels FOR INSERT
  WITH CHECK (company_id = app_company_id() AND app_has_permission('estacion.crear'));
CREATE POLICY stock_levels_estacion_update ON stock_levels FOR UPDATE
  USING (company_id = app_company_id() AND app_has_permission('estacion.crear'))
  WITH CHECK (company_id = app_company_id());
CREATE POLICY stock_movements_estacion_select ON stock_movements FOR SELECT
  USING (company_id = app_company_id() AND app_has_permission('estacion.crear'));
CREATE POLICY stock_movements_estacion_insert ON stock_movements FOR INSERT
  WITH CHECK (company_id = app_company_id() AND app_has_permission('estacion.crear'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talon_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      fuel_products, fuel_taxes, fuel_prices, fuel_tanks, fuel_pumps, fuel_nozzles,
      fuel_shifts, fuel_readings, fuel_payments, fuel_shop_lines, fuel_deliveries,
      fuel_sticks, fleet_vehicles, fleet_drivers, fleet_vouchers
    TO talon_app;
  END IF;
END $$;
