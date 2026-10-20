ALTER TABLE users ADD COLUMN IF NOT EXISTS last_company_id uuid;

CREATE OR REPLACE FUNCTION auth_home_company(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM memberships m
  JOIN companies c ON c.id = m.company_id
  LEFT JOIN users u ON u.id = p_user_id
  WHERE m.user_id = p_user_id AND m.active AND c.active
  ORDER BY (c.id = u.last_company_id) DESC, c.created_at
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION auth_remember_company(p_user_id uuid, p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships m
    JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = p_user_id AND m.company_id = p_company_id AND m.active AND c.active
  ) THEN
    RAISE EXCEPTION 'No pertenecés a esa empresa';
  END IF;
  UPDATE users SET last_company_id = p_company_id WHERE id = p_user_id;
END $$;

CREATE OR REPLACE FUNCTION auth_attach_user(p_email text, p_role_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  IF app_company_id() IS NULL OR NOT app_has_permission('configuracion.crear') THEN
    RAISE EXCEPTION 'No tenés permiso para sumar usuarios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = p_role_id AND company_id = app_company_id()) THEN
    RAISE EXCEPTION 'Ese puesto no es de esta empresa';
  END IF;
  SELECT id INTO uid FROM users WHERE lower(email) = lower(btrim(p_email)) AND active;
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO memberships (user_id, company_id, role_id)
  VALUES (uid, app_company_id(), p_role_id)
  ON CONFLICT (user_id, company_id) DO UPDATE SET role_id = excluded.role_id, active = true;
  RETURN uid;
END $$;

INSERT INTO cash_accounts (company_id, name, kind, active)
SELECT c.id, 'Caja', 'caja', true
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM cash_accounts a WHERE a.company_id = c.id);

INSERT INTO document_types (company_id, code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
SELECT c.id, t.code, t.name, t.kind, t.sign, t.moves_stock, t.stock_factor, t.moves_account, t.account_side, t.moves_cash, t.cash_direction, t.moves_vat, t.afip_codes::jsonb
FROM companies c
CROSS JOIN (VALUES
  ('NCR', 'Nota de crédito', 'venta', -1, true, 1, true, 'credit', true, 'out', true, '{"A":3,"B":8,"C":13}'),
  ('PED', 'Pedido', 'pedido', 1, false, 0, false, NULL, false, NULL, false, '{}'),
  ('REM', 'Remito', 'remito', 1, true, -1, false, NULL, false, NULL, false, '{}'),
  ('FCP', 'Factura de compra', 'compra', 1, true, 1, true, 'credit', true, 'out', true, '{"A":1,"B":6,"C":11}'),
  ('NCC', 'Nota de crédito de compra', 'compra', -1, true, -1, true, 'debit', true, 'in', true, '{"A":3,"B":8,"C":13}')
) AS t(code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
WHERE NOT EXISTS (
  SELECT 1 FROM document_types d WHERE d.company_id = c.id AND d.code = t.code
);

UPDATE companies
SET enabled_modules = (
  SELECT array_agg(DISTINCT m) FROM unnest(enabled_modules || ARRAY['stock', 'contabilidad', 'reparto', 'compras']) AS m
)
WHERE slug = 'estacion-almafuerte';

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES
  ('reparto.ver'), ('reparto.crear'), ('reparto.editar'), ('reparto.anular'), ('reparto.importar'), ('reparto.exportar')
) AS p(permission)
WHERE r.key = 'admin'
ON CONFLICT DO NOTHING;

CREATE TABLE fuel_trucks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  plate text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, plate)
);

CREATE TABLE fuel_compartments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  truck_id uuid NOT NULL REFERENCES fuel_trucks (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES fuel_products (id),
  name text NOT NULL,
  capacity numeric(14, 3) NOT NULL,
  quantity numeric(14, 3) NOT NULL DEFAULT 0
);

CREATE TABLE fuel_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  truck_id uuid NOT NULL REFERENCES fuel_trucks (id),
  driver_user_id uuid,
  driver_name text NOT NULL,
  status text NOT NULL DEFAULT 'abierto',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  km_start numeric(12, 1),
  km_end numeric(12, 1),
  notes text
);

CREATE TABLE fuel_trip_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES fuel_trips (id) ON DELETE CASCADE,
  kind text NOT NULL,
  tank_id uuid,
  compartment_id uuid,
  customer_id uuid,
  document_id uuid,
  liters numeric(14, 3),
  amount_cents bigint,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fuel_trips_company_idx ON fuel_trips (company_id, opened_at DESC);
CREATE INDEX fuel_trip_events_trip_idx ON fuel_trip_events (trip_id);

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['fuel_trucks','fuel_compartments','fuel_trips','fuel_trip_events']) AS tbl
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (company_id = app_company_id() AND app_has_permission(''reparto.ver''))',
      r.tbl || '_select', r.tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (company_id = app_company_id() AND (app_has_permission(''reparto.crear'') OR app_has_permission(''reparto.editar'')))',
      r.tbl || '_insert', r.tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (company_id = app_company_id() AND (app_has_permission(''reparto.crear'') OR app_has_permission(''reparto.editar''))) WITH CHECK (company_id = app_company_id())',
      r.tbl || '_update', r.tbl
    );
  END LOOP;
END $$;

CREATE POLICY fuel_trip_events_estacion_select ON fuel_trip_events FOR SELECT
  USING (company_id = app_company_id() AND app_has_permission('estacion.ver') AND kind IN ('carga', 'retorno'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talon_app') THEN
    GRANT EXECUTE ON FUNCTION auth_home_company(uuid) TO talon_app;
    GRANT EXECUTE ON FUNCTION auth_remember_company(uuid, uuid) TO talon_app;
    GRANT EXECUTE ON FUNCTION auth_attach_user(text, uuid) TO talon_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON fuel_trucks, fuel_compartments, fuel_trips, fuel_trip_events TO talon_app;
  END IF;
END $$;
