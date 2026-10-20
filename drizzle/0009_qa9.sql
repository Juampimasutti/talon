UPDATE companies
SET enabled_modules = (
  SELECT array_agg(DISTINCT m) FROM unnest(enabled_modules || ARRAY['informes']) AS m
);

INSERT INTO document_types (company_id, code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
SELECT c.id, 'REM', 'Remito', 'remito', 1, true, -1, false, NULL, false, NULL, false, '{}'::jsonb
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM document_types d WHERE d.company_id = c.id AND d.kind = 'remito'
);

INSERT INTO cash_accounts (company_id, name, kind, active)
SELECT c.id, 'Caja', 'caja', true
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM cash_accounts a WHERE a.company_id = c.id);
