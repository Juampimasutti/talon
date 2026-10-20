CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  entity text NOT NULL,
  filename text NOT NULL,
  status text NOT NULL,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_rows (
  job_id uuid NOT NULL REFERENCES import_jobs (id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw jsonb NOT NULL,
  values jsonb NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate boolean NOT NULL DEFAULT false,
  missing_iva boolean NOT NULL DEFAULT false,
  row_key text NOT NULL DEFAULT '',
  action text NOT NULL DEFAULT 'pendiente',
  undo jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (job_id, row_number)
);

CREATE TABLE import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  entity text NOT NULL,
  name text NOT NULL,
  mapping jsonb NOT NULL,
  UNIQUE (company_id, entity, name)
);

CREATE INDEX import_jobs_company_idx ON import_jobs (company_id, created_at DESC);
CREATE INDEX import_rows_key_idx ON import_rows (job_id, row_key);

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY import_jobs_all ON import_jobs FOR ALL
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY import_rows_all ON import_rows FOR ALL
  USING (EXISTS (SELECT 1 FROM import_jobs j WHERE j.id = job_id AND j.company_id = app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM import_jobs j WHERE j.id = job_id AND j.company_id = app_company_id()));

ALTER TABLE import_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY import_templates_all ON import_templates FOR ALL
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (VALUES
  ('admin', 'clientes.importar'),
  ('admin', 'proveedores.importar'),
  ('admin', 'articulos.importar'),
  ('admin', 'ventas.importar'),
  ('admin', 'compras.importar'),
  ('admin', 'pedidos.importar'),
  ('admin', 'remitos.importar'),
  ('admin', 'stock.importar'),
  ('admin', 'caja.importar'),
  ('admin', 'cuentas_corrientes.importar'),
  ('admin', 'contabilidad.importar'),
  ('admin', 'comprobantes.importar'),
  ('admin', 'configuracion.importar'),
  ('vendedor', 'clientes.importar'),
  ('vendedor', 'clientes.exportar'),
  ('vendedor', 'ventas.importar'),
  ('vendedor', 'pedidos.importar'),
  ('vendedor', 'remitos.importar'),
  ('deposito', 'stock.importar'),
  ('deposito', 'remitos.importar'),
  ('compras', 'proveedores.importar'),
  ('compras', 'articulos.importar'),
  ('compras', 'articulos.exportar'),
  ('compras', 'compras.importar')
) AS p(role_key, permission) ON p.role_key = r.key
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS customers_insert ON customers;
DROP POLICY IF EXISTS customers_update ON customers;
DROP POLICY IF EXISTS customers_delete ON customers;
CREATE POLICY customers_insert ON customers FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (app_has_permission('clientes.crear') OR app_has_permission('clientes.importar')));
CREATE POLICY customers_update ON customers FOR UPDATE
  USING (company_id = app_company_id() AND (app_has_permission('clientes.editar') OR app_has_permission('clientes.importar')))
  WITH CHECK (company_id = app_company_id());
CREATE POLICY customers_delete ON customers FOR DELETE
  USING (company_id = app_company_id() AND (app_has_permission('clientes.editar') OR app_has_permission('clientes.importar')));

DROP POLICY IF EXISTS suppliers_insert ON suppliers;
DROP POLICY IF EXISTS suppliers_update ON suppliers;
DROP POLICY IF EXISTS suppliers_delete ON suppliers;
CREATE POLICY suppliers_insert ON suppliers FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (app_has_permission('proveedores.crear') OR app_has_permission('proveedores.importar')));
CREATE POLICY suppliers_update ON suppliers FOR UPDATE
  USING (company_id = app_company_id() AND (app_has_permission('proveedores.editar') OR app_has_permission('proveedores.importar')))
  WITH CHECK (company_id = app_company_id());
CREATE POLICY suppliers_delete ON suppliers FOR DELETE
  USING (company_id = app_company_id() AND (app_has_permission('proveedores.editar') OR app_has_permission('proveedores.importar')));

DROP POLICY IF EXISTS products_insert ON products;
DROP POLICY IF EXISTS products_update ON products;
DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_insert ON products FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (app_has_permission('articulos.crear') OR app_has_permission('articulos.importar')));
CREATE POLICY products_update ON products FOR UPDATE
  USING (company_id = app_company_id() AND (app_has_permission('articulos.editar') OR app_has_permission('articulos.importar')))
  WITH CHECK (company_id = app_company_id());
CREATE POLICY products_delete ON products FOR DELETE
  USING (company_id = app_company_id() AND (app_has_permission('articulos.editar') OR app_has_permission('articulos.importar')));

DROP POLICY IF EXISTS product_prices_insert ON product_prices;
DROP POLICY IF EXISTS product_prices_update ON product_prices;
DROP POLICY IF EXISTS product_prices_delete ON product_prices;
CREATE POLICY product_prices_insert ON product_prices FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (app_has_permission('articulos.crear') OR app_has_permission('articulos.editar') OR app_has_permission('articulos.importar')));
CREATE POLICY product_prices_update ON product_prices FOR UPDATE
  USING (company_id = app_company_id() AND (app_has_permission('articulos.editar') OR app_has_permission('articulos.importar')))
  WITH CHECK (company_id = app_company_id());
CREATE POLICY product_prices_delete ON product_prices FOR DELETE
  USING (company_id = app_company_id() AND (app_has_permission('articulos.editar') OR app_has_permission('articulos.importar')));

DROP POLICY IF EXISTS ledger_accounts_insert ON ledger_accounts;
DROP POLICY IF EXISTS ledger_accounts_update ON ledger_accounts;
DROP POLICY IF EXISTS ledger_accounts_delete ON ledger_accounts;
CREATE POLICY ledger_accounts_insert ON ledger_accounts FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (app_has_permission('contabilidad.crear') OR app_has_permission('contabilidad.importar')));
CREATE POLICY ledger_accounts_update ON ledger_accounts FOR UPDATE
  USING (company_id = app_company_id() AND (app_has_permission('contabilidad.editar') OR app_has_permission('contabilidad.importar')))
  WITH CHECK (company_id = app_company_id());
CREATE POLICY ledger_accounts_delete ON ledger_accounts FOR DELETE
  USING (company_id = app_company_id() AND (app_has_permission('contabilidad.editar') OR app_has_permission('contabilidad.importar')));

DROP POLICY IF EXISTS documents_insert ON documents;
CREATE POLICY documents_insert ON documents FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (
    app_has_permission(module_for_kind(kind) || '.crear')
    OR app_has_permission(module_for_kind(kind) || '.importar')
  ));
CREATE POLICY documents_delete ON documents FOR DELETE
  USING (company_id = app_company_id() AND (
    app_has_permission(module_for_kind(kind) || '.anular')
    OR app_has_permission(module_for_kind(kind) || '.importar')
  ));

DROP POLICY IF EXISTS document_lines_insert ON document_lines;
CREATE POLICY document_lines_insert ON document_lines FOR INSERT
  WITH CHECK (
    company_id = app_company_id()
    AND EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_id
        AND (app_has_permission(module_for_kind(d.kind) || '.crear') OR app_has_permission(module_for_kind(d.kind) || '.importar'))
    )
  );
CREATE POLICY document_taxes_delete ON document_taxes FOR DELETE
  USING (
    company_id = app_company_id()
    AND EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_id
        AND (app_has_permission(module_for_kind(d.kind) || '.anular') OR app_has_permission(module_for_kind(d.kind) || '.importar'))
    )
  );

CREATE POLICY document_lines_delete ON document_lines FOR DELETE
  USING (
    company_id = app_company_id()
    AND EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_id
        AND (app_has_permission(module_for_kind(d.kind) || '.anular') OR app_has_permission(module_for_kind(d.kind) || '.importar'))
    )
  );

DROP POLICY IF EXISTS stock_levels_insert ON stock_levels;
DROP POLICY IF EXISTS stock_levels_update ON stock_levels;
CREATE POLICY stock_levels_insert ON stock_levels FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (
    app_has_permission('stock.crear') OR app_has_permission('stock.editar') OR app_has_permission('stock.importar')
    OR app_has_permission('ventas.crear') OR app_has_permission('ventas.anular') OR app_has_permission('ventas.importar')
    OR app_has_permission('compras.crear') OR app_has_permission('compras.anular') OR app_has_permission('compras.importar')
    OR app_has_permission('remitos.crear') OR app_has_permission('remitos.anular')
  ));
CREATE POLICY stock_levels_update ON stock_levels FOR UPDATE
  USING (company_id = app_company_id() AND (
    app_has_permission('stock.crear') OR app_has_permission('stock.editar') OR app_has_permission('stock.importar')
    OR app_has_permission('ventas.crear') OR app_has_permission('ventas.anular') OR app_has_permission('ventas.importar')
    OR app_has_permission('compras.crear') OR app_has_permission('compras.anular') OR app_has_permission('compras.importar')
    OR app_has_permission('remitos.crear') OR app_has_permission('remitos.anular')
  ))
  WITH CHECK (company_id = app_company_id());

CREATE POLICY price_lists_import ON price_lists FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (app_has_permission('articulos.importar') OR app_has_permission('configuracion.editar')));
CREATE POLICY price_lists_import_update ON price_lists FOR UPDATE
  USING (company_id = app_company_id() AND (app_has_permission('articulos.importar') OR app_has_permission('configuracion.editar')))
  WITH CHECK (company_id = app_company_id());

DROP POLICY IF EXISTS custom_field_values_insert ON custom_field_values;
DROP POLICY IF EXISTS custom_field_values_update ON custom_field_values;
DROP POLICY IF EXISTS custom_field_values_delete ON custom_field_values;
CREATE POLICY custom_field_values_insert ON custom_field_values FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (
    app_has_permission('configuracion.editar')
    OR app_has_permission('clientes.crear') OR app_has_permission('clientes.editar') OR app_has_permission('clientes.importar')
    OR app_has_permission('proveedores.crear') OR app_has_permission('proveedores.editar') OR app_has_permission('proveedores.importar')
    OR app_has_permission('articulos.crear') OR app_has_permission('articulos.editar') OR app_has_permission('articulos.importar')
  ));
CREATE POLICY custom_field_values_update ON custom_field_values FOR UPDATE
  USING (company_id = app_company_id() AND (
    app_has_permission('configuracion.editar')
    OR app_has_permission('clientes.editar') OR app_has_permission('clientes.importar')
    OR app_has_permission('proveedores.editar') OR app_has_permission('proveedores.importar')
    OR app_has_permission('articulos.editar') OR app_has_permission('articulos.importar')
  ))
  WITH CHECK (company_id = app_company_id());
CREATE POLICY custom_field_values_delete ON custom_field_values FOR DELETE
  USING (company_id = app_company_id() AND (
    app_has_permission('configuracion.editar')
    OR app_has_permission('clientes.editar') OR app_has_permission('clientes.importar')
    OR app_has_permission('proveedores.editar') OR app_has_permission('proveedores.importar')
    OR app_has_permission('articulos.editar') OR app_has_permission('articulos.importar')
  ));

CREATE POLICY current_account_delete ON current_account_entries FOR DELETE
  USING (company_id = app_company_id() AND (
    app_has_permission('ventas.importar')
    OR app_has_permission('compras.importar')
    OR app_has_permission('ventas.anular')
    OR app_has_permission('compras.anular')
  ));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talon_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON import_jobs, import_rows, import_templates TO talon_app;
  END IF;
END $$;
