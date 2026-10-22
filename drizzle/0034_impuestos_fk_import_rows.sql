-- Borrar un comprobante importado fallaba: la FK compuesta (comprobante_id, company_id)
-- con ON DELETE SET NULL ponía en NULL también company_id, que es NOT NULL.
-- Desde PostgreSQL 15 se puede indicar qué columnas anular (Talón usa postgres:16).
ALTER TABLE imp_import_rows DROP CONSTRAINT IF EXISTS imp_import_rows_comprobante_id_company_id_fkey;
ALTER TABLE imp_import_rows
  ADD CONSTRAINT imp_import_rows_comprobante_id_company_id_fkey
  FOREIGN KEY (comprobante_id, company_id) REFERENCES imp_comprobantes(id, company_id)
  ON DELETE SET NULL (comprobante_id);
