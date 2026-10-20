-- Talón: esquema inicial, índices, funciones de sesión y RLS por empresa.
-- El runtime entra como talon_app (sin superuser y sin bypassrls).
-- Migraciones y seed entran como dueño.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION module_for_kind(k text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE k
    WHEN 'venta' THEN 'ventas'
    WHEN 'compra' THEN 'compras'
    WHEN 'pedido' THEN 'pedidos'
    WHEN 'remito' THEN 'remitos'
    WHEN 'cobro' THEN 'caja'
    WHEN 'pago' THEN 'caja'
    ELSE k
  END
$$;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_name text NOT NULL,
  cuit text NOT NULL,
  tax_condition text NOT NULL,
  iibb text,
  address text,
  city text,
  province text,
  postal_code text,
  phone text,
  email text,
  point_of_sale integer NOT NULL DEFAULT 1,
  enabled_modules text[] NOT NULL DEFAULT '{}',
  block_negative_stock boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_tax_condition CHECK (tax_condition IN ('ri', 'monotributo', 'cf', 'exento'))
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, key)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles (id),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (user_id, company_id)
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  UNIQUE (company_id, kind, name)
);

CREATE TABLE price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, name)
);

CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, name)
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  fantasy_name text,
  doc_type text NOT NULL DEFAULT 'CUIT',
  cuit text,
  tax_condition text NOT NULL,
  address text,
  city text,
  province text,
  phone text,
  email text,
  payment_terms_days integer NOT NULL DEFAULT 0,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  fantasy_name text,
  doc_type text NOT NULL DEFAULT 'CUIT',
  cuit text,
  tax_condition text NOT NULL,
  iibb text,
  iibb_perception_bps integer,
  address text,
  city text,
  province text,
  postal_code text,
  phone text,
  email text,
  contact text,
  price_list_id uuid REFERENCES price_lists (id),
  discount_bps integer NOT NULL DEFAULT 0,
  credit_limit_cents bigint NOT NULL DEFAULT 0,
  payment_terms_days integer NOT NULL DEFAULT 0,
  zone text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  sku text NOT NULL,
  barcode text,
  name text NOT NULL,
  category_id uuid REFERENCES categories (id),
  unit text NOT NULL DEFAULT 'u',
  iva_rate_bps integer NOT NULL DEFAULT 2100,
  tax_treatment text NOT NULL DEFAULT 'gravado',
  tracks_stock boolean NOT NULL DEFAULT true,
  cost_cents bigint NOT NULL DEFAULT 0,
  min_stock numeric(14, 3) NOT NULL DEFAULT 0,
  supplier_id uuid REFERENCES suppliers (id),
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku),
  CONSTRAINT products_tax_treatment CHECK (tax_treatment IN ('gravado', 'exento', 'no_gravado'))
);

CREATE TABLE product_prices (
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL REFERENCES price_lists (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  price_cents bigint NOT NULL,
  PRIMARY KEY (product_id, price_list_id)
);

CREATE TABLE stock_levels (
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  quantity numeric(14, 3) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  sign integer NOT NULL DEFAULT 1,
  moves_stock boolean NOT NULL DEFAULT false,
  stock_factor integer NOT NULL DEFAULT 0,
  moves_account boolean NOT NULL DEFAULT false,
  account_side text,
  moves_cash boolean NOT NULL DEFAULT false,
  cash_direction text,
  moves_vat boolean NOT NULL DEFAULT false,
  electronic boolean NOT NULL DEFAULT false,
  afip_codes jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_number integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE cash_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  kind text NOT NULL,
  document_type_id uuid NOT NULL REFERENCES document_types (id),
  letter text,
  point_of_sale integer NOT NULL,
  number integer NOT NULL,
  issued_on date NOT NULL,
  party_type text NOT NULL,
  party_id uuid,
  party_name text NOT NULL,
  party_cuit text,
  party_tax_condition text,
  price_list_id uuid,
  warehouse_id uuid,
  payment_method text NOT NULL DEFAULT 'cuenta_corriente',
  price_mode text NOT NULL,
  status text NOT NULL DEFAULT 'confirmado',
  notes text,
  net_taxed_cents bigint NOT NULL,
  net_untaxed_cents bigint NOT NULL,
  exempt_cents bigint NOT NULL,
  vat_cents bigint NOT NULL,
  perceptions_cents bigint NOT NULL,
  other_taxes_cents bigint NOT NULL,
  total_cents bigint NOT NULL,
  cae text,
  cae_due date,
  cae_status text NOT NULL DEFAULT 'no_electronico',
  voided_at timestamptz,
  void_reason text,
  voided_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, document_type_id, point_of_sale, number)
);

CREATE TABLE document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  position integer NOT NULL,
  product_id uuid,
  sku text,
  description text NOT NULL,
  quantity numeric(14, 3) NOT NULL,
  unit_price_cents bigint NOT NULL,
  discount_bps integer NOT NULL DEFAULT 0,
  iva_rate_bps integer NOT NULL DEFAULT 0,
  tax_treatment text NOT NULL DEFAULT 'gravado',
  net_cents bigint NOT NULL,
  vat_cents bigint NOT NULL,
  exempt_cents bigint NOT NULL,
  untaxed_cents bigint NOT NULL,
  total_cents bigint NOT NULL
);

CREATE TABLE document_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  name text NOT NULL,
  rate_bps integer NOT NULL,
  base_cents bigint NOT NULL,
  amount_cents bigint NOT NULL
);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products (id),
  warehouse_id uuid NOT NULL REFERENCES warehouses (id),
  quantity numeric(14, 3) NOT NULL,
  reason text NOT NULL,
  document_id uuid REFERENCES documents (id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  cash_account_id uuid NOT NULL REFERENCES cash_accounts (id),
  document_id uuid REFERENCES documents (id),
  direction text NOT NULL,
  amount_cents bigint NOT NULL,
  description text NOT NULL,
  occurred_on date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  parent_code text,
  imputable boolean NOT NULL DEFAULT true,
  kind text NOT NULL,
  UNIQUE (company_id, code)
);

CREATE TABLE current_account_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  party_type text NOT NULL,
  party_id uuid NOT NULL,
  document_id uuid REFERENCES documents (id),
  occurred_on date NOT NULL,
  description text NOT NULL,
  debit_cents bigint NOT NULL DEFAULT 0,
  credit_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE custom_field_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  entity text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  UNIQUE (company_id, entity, key)
);

CREATE TABLE custom_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES custom_field_defs (id) ON DELETE CASCADE,
  record_id uuid NOT NULL,
  value text NOT NULL DEFAULT '',
  UNIQUE (field_id, record_id)
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customers_company_name_idx ON customers (company_id, name);
CREATE INDEX customers_company_cuit_idx ON customers (company_id, cuit);
CREATE INDEX customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX suppliers_company_name_idx ON suppliers (company_id, name);
CREATE INDEX suppliers_name_trgm ON suppliers USING gin (name gin_trgm_ops);
CREATE INDEX products_company_sku_idx ON products (company_id, sku);
CREATE INDEX products_company_name_idx ON products (company_id, name);
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX products_sku_trgm ON products USING gin (sku gin_trgm_ops);
CREATE INDEX documents_list_idx ON documents (company_id, kind, issued_on DESC, created_at DESC);
CREATE INDEX documents_party_idx ON documents (company_id, party_type, party_id);
CREATE INDEX document_lines_document_idx ON document_lines (document_id);
CREATE INDEX document_taxes_document_idx ON document_taxes (document_id);
CREATE INDEX stock_movements_product_idx ON stock_movements (company_id, product_id, created_at DESC);
CREATE INDEX cash_movements_date_idx ON cash_movements (company_id, occurred_on DESC);
CREATE INDEX current_account_party_idx ON current_account_entries (company_id, party_type, party_id, occurred_on);
CREATE INDEX audit_company_date_idx ON audit_log (company_id, created_at DESC);
CREATE INDEX custom_values_record_idx ON custom_field_values (record_id);

CREATE OR REPLACE FUNCTION app_has_permission(p text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships m
    JOIN role_permissions rp ON rp.role_id = m.role_id
    WHERE m.user_id = app_user_id()
      AND m.company_id = app_company_id()
      AND m.active
      AND rp.permission = p
  )
$$;

CREATE OR REPLACE FUNCTION auth_find_user(p_email text)
RETURNS TABLE (id uuid, name text, email text, password_hash text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.name, u.email, u.password_hash, u.active
  FROM users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION auth_create_session(p_user_id uuid, p_token_hash text, p_expires timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO sessions (user_id, token_hash, expires_at)
  VALUES (p_user_id, p_token_hash, p_expires)
$$;

CREATE OR REPLACE FUNCTION auth_delete_session(p_token_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM sessions WHERE token_hash = p_token_hash
$$;

CREATE OR REPLACE FUNCTION auth_context(p_token_hash text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email),
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'companyId', c.id,
        'companyName', c.name,
        'legalName', c.legal_name,
        'cuit', c.cuit,
        'taxCondition', c.tax_condition,
        'pointOfSale', c.point_of_sale,
        'city', c.city,
        'province', c.province,
        'enabledModules', c.enabled_modules,
        'blockNegativeStock', c.block_negative_stock,
        'roleId', r.id,
        'roleKey', r.key,
        'roleName', r.name,
        'permissions', COALESCE((
          SELECT jsonb_agg(rp.permission) FROM role_permissions rp WHERE rp.role_id = r.id
        ), '[]'::jsonb)
      ) ORDER BY c.created_at)
      FROM memberships m
      JOIN companies c ON c.id = m.company_id
      JOIN roles r ON r.id = m.role_id
      WHERE m.user_id = u.id AND m.active AND c.active
    ), '[]'::jsonb)
  )
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.expires_at > now()
    AND u.active
$$;

CREATE OR REPLACE FUNCTION document_types_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('is_superuser') = 'on' OR app_has_permission('comprobantes.editar') THEN
    RETURN NEW;
  END IF;
  IF NEW.company_id = OLD.company_id
     AND NEW.code = OLD.code
     AND NEW.name = OLD.name
     AND NEW.kind = OLD.kind
     AND NEW.sign = OLD.sign
     AND NEW.moves_stock = OLD.moves_stock
     AND NEW.stock_factor = OLD.stock_factor
     AND NEW.moves_account = OLD.moves_account
     AND NEW.account_side IS NOT DISTINCT FROM OLD.account_side
     AND NEW.moves_cash = OLD.moves_cash
     AND NEW.cash_direction IS NOT DISTINCT FROM OLD.cash_direction
     AND NEW.moves_vat = OLD.moves_vat
     AND NEW.electronic = OLD.electronic
     AND NEW.afip_codes = OLD.afip_codes
     AND NEW.active = OLD.active
     AND NEW.next_number IS DISTINCT FROM OLD.next_number THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'No podés modificar este tipo de comprobante';
END;
$$;

CREATE TRIGGER document_types_guard
  BEFORE UPDATE ON document_types
  FOR EACH ROW EXECUTE FUNCTION document_types_guard();

-- Políticas: aislamiento por empresa y permiso de módulo.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('customers', 'clientes'),
    ('suppliers', 'proveedores'),
    ('products', 'articulos'),
    ('product_prices', 'articulos'),
    ('ledger_accounts', 'contabilidad')
  ) AS t(tbl, mod)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (company_id = app_company_id() AND app_has_permission(%L))',
      r.tbl || '_select', r.tbl, r.mod || '.ver'
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (company_id = app_company_id() AND app_has_permission(%L))',
      r.tbl || '_insert', r.tbl, r.mod || '.crear'
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (company_id = app_company_id() AND app_has_permission(%L)) WITH CHECK (company_id = app_company_id() AND app_has_permission(%L))',
      r.tbl || '_update', r.tbl, r.mod || '.editar', r.mod || '.editar'
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (company_id = app_company_id() AND app_has_permission(%L))',
      r.tbl || '_delete', r.tbl, r.mod || '.editar'
    );
  END LOOP;
END $$;

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY categories_select ON categories FOR SELECT USING (company_id = app_company_id());
CREATE POLICY categories_write ON categories FOR ALL
  USING (company_id = app_company_id() AND app_has_permission('configuracion.editar'))
  WITH CHECK (company_id = app_company_id() AND app_has_permission('configuracion.editar'));

ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_lists FORCE ROW LEVEL SECURITY;
CREATE POLICY price_lists_select ON price_lists FOR SELECT USING (company_id = app_company_id());
CREATE POLICY price_lists_write ON price_lists FOR ALL
  USING (company_id = app_company_id() AND app_has_permission('configuracion.editar'))
  WITH CHECK (company_id = app_company_id() AND app_has_permission('configuracion.editar'));

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;
CREATE POLICY warehouses_select ON warehouses FOR SELECT USING (company_id = app_company_id());
CREATE POLICY warehouses_write ON warehouses FOR ALL
  USING (company_id = app_company_id() AND (app_has_permission('configuracion.editar') OR app_has_permission('stock.editar')))
  WITH CHECK (company_id = app_company_id() AND (app_has_permission('configuracion.editar') OR app_has_permission('stock.editar')));

ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_types FORCE ROW LEVEL SECURITY;
CREATE POLICY document_types_select ON document_types FOR SELECT USING (company_id = app_company_id());
CREATE POLICY document_types_insert ON document_types FOR INSERT
  WITH CHECK (company_id = app_company_id() AND app_has_permission('comprobantes.crear'));
CREATE POLICY document_types_update ON document_types FOR UPDATE
  USING (
    company_id = app_company_id()
    AND (
      app_has_permission('comprobantes.editar')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('compras.crear')
      OR app_has_permission('pedidos.crear')
      OR app_has_permission('remitos.crear')
    )
  )
  WITH CHECK (company_id = app_company_id());

ALTER TABLE cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_accounts_select ON cash_accounts FOR SELECT USING (company_id = app_company_id());
CREATE POLICY cash_accounts_write ON cash_accounts FOR ALL
  USING (company_id = app_company_id() AND (app_has_permission('caja.editar') OR app_has_permission('configuracion.editar')))
  WITH CHECK (company_id = app_company_id() AND (app_has_permission('caja.editar') OR app_has_permission('configuracion.editar')));

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_select ON documents FOR SELECT
  USING (company_id = app_company_id() AND app_has_permission(module_for_kind(kind) || '.ver'));
CREATE POLICY documents_insert ON documents FOR INSERT
  WITH CHECK (company_id = app_company_id() AND app_has_permission(module_for_kind(kind) || '.crear'));
CREATE POLICY documents_update ON documents FOR UPDATE
  USING (
    company_id = app_company_id()
    AND (app_has_permission(module_for_kind(kind) || '.editar') OR app_has_permission(module_for_kind(kind) || '.anular'))
  )
  WITH CHECK (company_id = app_company_id());

ALTER TABLE document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY document_lines_select ON document_lines FOR SELECT
  USING (
    company_id = app_company_id()
    AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id)
  );
CREATE POLICY document_lines_insert ON document_lines FOR INSERT
  WITH CHECK (
    company_id = app_company_id()
    AND EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_id
        AND app_has_permission(module_for_kind(d.kind) || '.crear')
    )
  );

ALTER TABLE document_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_taxes FORCE ROW LEVEL SECURITY;
CREATE POLICY document_taxes_select ON document_taxes FOR SELECT
  USING (
    company_id = app_company_id()
    AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id)
  );
CREATE POLICY document_taxes_insert ON document_taxes FOR INSERT
  WITH CHECK (
    company_id = app_company_id()
    AND EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_id
        AND app_has_permission(module_for_kind(d.kind) || '.crear')
    )
  );

ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_levels FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_levels_select ON stock_levels FOR SELECT
  USING (
    company_id = app_company_id()
    AND (
      app_has_permission('stock.ver')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('ventas.anular')
      OR app_has_permission('compras.crear')
      OR app_has_permission('compras.anular')
      OR app_has_permission('remitos.crear')
      OR app_has_permission('remitos.anular')
    )
  );
CREATE POLICY stock_levels_insert ON stock_levels FOR INSERT
  WITH CHECK (
    company_id = app_company_id()
    AND (
      app_has_permission('stock.crear')
      OR app_has_permission('stock.editar')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('ventas.anular')
      OR app_has_permission('compras.crear')
      OR app_has_permission('compras.anular')
      OR app_has_permission('remitos.crear')
      OR app_has_permission('remitos.anular')
    )
  );
CREATE POLICY stock_levels_update ON stock_levels FOR UPDATE
  USING (
    company_id = app_company_id()
    AND (
      app_has_permission('stock.crear')
      OR app_has_permission('stock.editar')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('ventas.anular')
      OR app_has_permission('compras.crear')
      OR app_has_permission('compras.anular')
      OR app_has_permission('remitos.crear')
      OR app_has_permission('remitos.anular')
    )
  )
  WITH CHECK (company_id = app_company_id());

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT
  USING (
    company_id = app_company_id()
    AND (
      app_has_permission('stock.ver')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('ventas.anular')
      OR app_has_permission('compras.crear')
      OR app_has_permission('compras.anular')
      OR app_has_permission('remitos.crear')
      OR app_has_permission('remitos.anular')
    )
  );
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT
  WITH CHECK (
    company_id = app_company_id()
    AND (
      app_has_permission('stock.crear')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('ventas.anular')
      OR app_has_permission('compras.crear')
      OR app_has_permission('compras.anular')
      OR app_has_permission('remitos.crear')
      OR app_has_permission('remitos.anular')
    )
  );

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_movements_select ON cash_movements FOR SELECT
  USING (company_id = app_company_id() AND app_has_permission('caja.ver'));
CREATE POLICY cash_movements_insert ON cash_movements FOR INSERT
  WITH CHECK (
    company_id = app_company_id()
    AND (
      app_has_permission('caja.crear')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('ventas.anular')
      OR app_has_permission('compras.crear')
      OR app_has_permission('compras.anular')
    )
  );

ALTER TABLE current_account_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE current_account_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY current_account_select ON current_account_entries FOR SELECT
  USING (company_id = app_company_id() AND app_has_permission('cuentas_corrientes.ver'));
CREATE POLICY current_account_insert ON current_account_entries FOR INSERT
  WITH CHECK (
    company_id = app_company_id()
    AND (
      app_has_permission('cuentas_corrientes.crear')
      OR app_has_permission('ventas.crear')
      OR app_has_permission('ventas.anular')
      OR app_has_permission('compras.crear')
      OR app_has_permission('compras.anular')
      OR app_has_permission('caja.crear')
    )
  );

ALTER TABLE custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_defs FORCE ROW LEVEL SECURITY;
CREATE POLICY custom_field_defs_select ON custom_field_defs FOR SELECT USING (company_id = app_company_id());
CREATE POLICY custom_field_defs_write ON custom_field_defs FOR ALL
  USING (company_id = app_company_id() AND app_has_permission('configuracion.editar'))
  WITH CHECK (company_id = app_company_id() AND app_has_permission('configuracion.editar'));

ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_values FORCE ROW LEVEL SECURITY;
CREATE POLICY custom_field_values_select ON custom_field_values FOR SELECT USING (company_id = app_company_id());
CREATE POLICY custom_field_values_insert ON custom_field_values FOR INSERT
  WITH CHECK (
    company_id = app_company_id()
    AND (
      app_has_permission('configuracion.editar')
      OR app_has_permission('clientes.crear') OR app_has_permission('clientes.editar')
      OR app_has_permission('proveedores.crear') OR app_has_permission('proveedores.editar')
      OR app_has_permission('articulos.crear') OR app_has_permission('articulos.editar')
    )
  );
CREATE POLICY custom_field_values_update ON custom_field_values FOR UPDATE
  USING (
    company_id = app_company_id()
    AND (
      app_has_permission('configuracion.editar')
      OR app_has_permission('clientes.editar')
      OR app_has_permission('proveedores.editar')
      OR app_has_permission('articulos.editar')
    )
  )
  WITH CHECK (company_id = app_company_id());
CREATE POLICY custom_field_values_delete ON custom_field_values FOR DELETE
  USING (
    company_id = app_company_id()
    AND (
      app_has_permission('configuracion.editar')
      OR app_has_permission('clientes.editar')
      OR app_has_permission('proveedores.editar')
      OR app_has_permission('articulos.editar')
    )
  );

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_select ON audit_log FOR SELECT
  USING (company_id = app_company_id() AND app_has_permission('auditoria.ver'));
CREATE POLICY audit_insert ON audit_log FOR INSERT
  WITH CHECK (company_id = app_company_id() AND app_user_id() IS NOT NULL);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY companies_select ON companies FOR SELECT USING (id = app_company_id());
CREATE POLICY companies_update ON companies FOR UPDATE
  USING (id = app_company_id() AND app_has_permission('configuracion.editar'))
  WITH CHECK (id = app_company_id() AND app_has_permission('configuracion.editar'));

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_select ON roles FOR SELECT USING (company_id = app_company_id());
CREATE POLICY roles_insert ON roles FOR INSERT
  WITH CHECK (company_id = app_company_id() AND app_has_permission('configuracion.crear'));
CREATE POLICY roles_update ON roles FOR UPDATE
  USING (company_id = app_company_id() AND app_has_permission('configuracion.editar'))
  WITH CHECK (company_id = app_company_id() AND app_has_permission('configuracion.editar'));

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select ON role_permissions FOR SELECT
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.company_id = app_company_id()));
CREATE POLICY role_permissions_insert ON role_permissions FOR INSERT
  WITH CHECK (
    app_has_permission('configuracion.editar')
    AND EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.company_id = app_company_id())
  );
CREATE POLICY role_permissions_delete ON role_permissions FOR DELETE
  USING (
    app_has_permission('configuracion.editar')
    AND EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.company_id = app_company_id())
  );

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON memberships FOR SELECT USING (company_id = app_company_id());
CREATE POLICY memberships_insert ON memberships FOR INSERT
  WITH CHECK (company_id = app_company_id() AND app_has_permission('configuracion.crear'));
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (company_id = app_company_id() AND app_has_permission('configuracion.editar'))
  WITH CHECK (company_id = app_company_id() AND app_has_permission('configuracion.editar'));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_select ON users FOR SELECT
  USING (
    id = app_user_id()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.company_id = app_company_id()
    )
  );
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (app_has_permission('configuracion.crear'));
CREATE POLICY users_update ON users FOR UPDATE
  USING (id = app_user_id() OR app_has_permission('configuracion.editar'))
  WITH CHECK (id = app_user_id() OR app_has_permission('configuracion.editar'));

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
-- Sin políticas para el rol de la app: solo entran las funciones SECURITY DEFINER.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talon_app') THEN
    GRANT USAGE ON SCHEMA public TO talon_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO talon_app;
    REVOKE ALL ON TABLE sessions FROM talon_app;
    GRANT EXECUTE ON FUNCTION app_company_id() TO talon_app;
    GRANT EXECUTE ON FUNCTION app_user_id() TO talon_app;
    GRANT EXECUTE ON FUNCTION app_has_permission(text) TO talon_app;
    GRANT EXECUTE ON FUNCTION module_for_kind(text) TO talon_app;
    GRANT EXECUTE ON FUNCTION auth_find_user(text) TO talon_app;
    GRANT EXECUTE ON FUNCTION auth_create_session(uuid, text, timestamptz) TO talon_app;
    GRANT EXECUTE ON FUNCTION auth_delete_session(text) TO talon_app;
    GRANT EXECUTE ON FUNCTION auth_context(text) TO talon_app;
  END IF;
END $$;
