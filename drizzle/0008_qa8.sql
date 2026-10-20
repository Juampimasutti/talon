ALTER TABLE companies ADD COLUMN IF NOT EXISTS allow_negative_cash boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sandbox_of uuid;

ALTER TABLE companies ALTER COLUMN block_negative_stock SET DEFAULT true;
UPDATE companies SET block_negative_stock = true WHERE block_negative_stock = false;

UPDATE document_types
SET moves_stock = true, stock_factor = -1
WHERE code IN ('FAC', 'REM', 'TIK') AND kind IN ('venta', 'remito');

INSERT INTO document_types (company_id, code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
SELECT c.id, 'TIK', 'Ticket', 'venta', 1, true, -1, false, NULL, true, 'in', true, '{"T":83}'::jsonb
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM document_types d WHERE d.company_id = c.id AND d.code = 'TIK');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES
  ('informes.ver'), ('informes.crear'), ('informes.editar'), ('informes.anular'), ('informes.importar'), ('informes.exportar')
) AS p(permission)
WHERE r.key = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES ('informes.ver'), ('informes.exportar')) AS p(permission)
WHERE r.key = 'contador'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES ('informes.ver'), ('informes.exportar')) AS p(permission)
WHERE r.key = 'encargado'
ON CONFLICT DO NOTHING;

UPDATE companies
SET enabled_modules = (
  SELECT array_agg(DISTINCT m) FROM unnest(enabled_modules || ARRAY['informes']) AS m
)
WHERE slug IN ('distribuidora-parana', 'estacion-almafuerte', 'costa-servicios');
