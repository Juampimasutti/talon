-- Borradores de liquidación IVA. No presentan declaraciones ante ARCA.

CREATE TABLE imp_liquidaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  periodo text NOT NULL CHECK (periodo ~ '^[0-9]{6}$' AND substring(periodo,5,2) BETWEEN '01' AND '12'),
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','confirmada')),
  totales jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb,
  confirmada_por uuid REFERENCES users(id),
  confirmada_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,periodo),
  UNIQUE(id,company_id),
  CHECK ((estado='borrador' AND confirmada_por IS NULL AND confirmada_at IS NULL)
      OR (estado='confirmada' AND confirmada_por IS NOT NULL AND confirmada_at IS NOT NULL AND snapshot IS NOT NULL))
);

CREATE TABLE imp_liquidacion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  liquidacion_id uuid NOT NULL,
  rubro text NOT NULL,
  concepto text NOT NULL,
  importe_cents bigint NOT NULL,
  origen text NOT NULL CHECK (origen IN ('calculado','manual')),
  posicion integer NOT NULL DEFAULT 0,
  FOREIGN KEY (liquidacion_id,company_id) REFERENCES imp_liquidaciones(id,company_id) ON DELETE CASCADE,
  UNIQUE(id,company_id)
);

CREATE OR REPLACE FUNCTION imp_liquidacion_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.estado='confirmada' THEN
    RAISE EXCEPTION 'La liquidación confirmada debe desbloquearse antes de eliminarse' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND OLD.estado='confirmada'
     AND NEW.estado='confirmada' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'La liquidación confirmada no se puede editar' USING ERRCODE='55000';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER imp_liquidacion_guard
  BEFORE UPDATE OR DELETE ON imp_liquidaciones
  FOR EACH ROW EXECUTE FUNCTION imp_liquidacion_guard();

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['imp_liquidaciones','imp_liquidacion_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (company_id=app_company_id() AND app_has_permission(''impuestos.ver''))',tbl||'_select',tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (company_id=app_company_id() AND app_has_permission(''impuestos.crear''))',tbl||'_insert',tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (company_id=app_company_id() AND app_has_permission(''impuestos.editar'')) WITH CHECK (company_id=app_company_id() AND app_has_permission(''impuestos.editar''))',tbl||'_update',tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (company_id=app_company_id() AND app_has_permission(''impuestos.anular''))',tbl||'_delete',tbl);
    EXECUTE format('CREATE TRIGGER lifecycle_write_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION company_write_gate()',tbl);
    EXECUTE format('CREATE TRIGGER lifecycle_statement_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION company_statement_gate()',tbl);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO talon_app',tbl);
  END LOOP;
END $$;
