-- Los remitos no mueven la cuenta corriente.
UPDATE document_types
SET moves_account = false, account_side = NULL
WHERE kind = 'remito';

DELETE FROM current_account_entries e
USING documents d
WHERE e.document_id = d.id AND d.kind = 'remito';

INSERT INTO document_types (company_id, code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
SELECT c.id, t.code, t.name, t.kind, t.sign, t.moves_stock, t.stock_factor, t.moves_account, t.account_side, t.moves_cash, t.cash_direction, t.moves_vat, t.afip_codes::jsonb
FROM companies c
CROSS JOIN (VALUES
  ('FAC', 'Factura A/B/C', 'venta', 1, true, -1, true, 'debit', true, 'in', true, '{"A":1,"B":6,"C":11}'),
  ('NCR', 'Nota de crédito', 'venta', -1, true, 1, true, 'credit', true, 'out', true, '{"A":3,"B":8,"C":13}'),
  ('ND', 'Nota de débito', 'venta', 1, false, 0, true, 'debit', false, NULL, true, '{"A":2,"B":7,"C":12}'),
  ('FCP', 'Factura de compra', 'compra', 1, true, 1, true, 'credit', true, 'out', true, '{"A":1,"B":6,"C":11}'),
  ('REM', 'Remito', 'remito', 1, true, -1, false, NULL, false, NULL, false, '{}'),
  ('REC', 'Recibo', 'venta', -1, false, 0, true, 'credit', true, 'in', false, '{}')
) AS t(code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
WHERE NOT EXISTS (
  SELECT 1 FROM document_types d WHERE d.company_id = c.id AND d.code = t.code
);
