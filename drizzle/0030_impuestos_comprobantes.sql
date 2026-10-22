-- Libro IVA e importación. Sólo crea tablas imp_; no altera comprobantes ni
-- maestros de Talón.

CREATE TABLE imp_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('mc_emitidos','mc_recibidos')),
  archivo_nombre text NOT NULL,
  archivo_hash text NOT NULL,
  estado text NOT NULL DEFAULT 'previsualizado' CHECK (estado IN ('procesando','previsualizado','confirmado','error')),
  resumen jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE(company_id,tipo,archivo_hash),
  UNIQUE(id,company_id)
);

CREATE TABLE imp_comprobantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  libro text NOT NULL CHECK (libro IN ('ventas','compras')),
  origen text NOT NULL CHECK (origen IN ('talon','mis_comprobantes','manual')),
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  import_row_id uuid,
  fecha_cbte date NOT NULL,
  periodo text NOT NULL CHECK (periodo ~ '^[0-9]{6}$' AND substring(periodo,5,2) BETWEEN '01' AND '12'),
  tipo_cbte integer NOT NULL REFERENCES imp_tipos_comprobante(codigo),
  punto_venta integer NOT NULL CHECK (punto_venta BETWEEN 0 AND 99999),
  numero_desde bigint NOT NULL CHECK (numero_desde >= 0),
  numero_hasta bigint NOT NULL CHECK (numero_hasta >= numero_desde),
  cae text,
  doc_nro_emisor text NOT NULL,
  doc_tipo integer NOT NULL,
  doc_nro text NOT NULL,
  denominacion text NOT NULL,
  condicion_iva integer REFERENCES imp_condiciones_iva(codigo),
  contraparte_id uuid,
  moneda text NOT NULL,
  tipo_cambio numeric(18,6) NOT NULL DEFAULT 1 CHECK (tipo_cambio > 0),
  neto_no_gravado_cents bigint NOT NULL DEFAULT 0,
  exento_cents bigint NOT NULL DEFAULT 0,
  percep_iva_cents bigint NOT NULL DEFAULT 0,
  percep_otros_nac_cents bigint NOT NULL DEFAULT 0,
  percep_iibb_cents bigint NOT NULL DEFAULT 0,
  percep_municipales_cents bigint NOT NULL DEFAULT 0,
  impuestos_internos_cents bigint NOT NULL DEFAULT 0,
  otros_tributos_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL,
  tipo_operacion text NOT NULL DEFAULT 'otros'
    CHECK (tipo_operacion IN ('bienes','servicios','locaciones','bienes_uso','importaciones','otros')),
  credito_fiscal_computable_cents bigint NOT NULL DEFAULT 0,
  prorratea boolean NOT NULL DEFAULT false,
  estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','anulado')),
  requiere_revision boolean NOT NULL DEFAULT false,
  avisos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contraparte_id,company_id) REFERENCES imp_contrapartes(id,company_id),
  UNIQUE(company_id,libro,doc_nro_emisor,tipo_cbte,punto_venta,numero_desde),
  UNIQUE(id,company_id)
);

CREATE UNIQUE INDEX imp_comprobantes_source
  ON imp_comprobantes(company_id,source_document_id)
  WHERE source_document_id IS NOT NULL;
CREATE INDEX imp_comprobantes_periodo ON imp_comprobantes(company_id,libro,periodo);

CREATE TABLE imp_comprobante_alicuotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  comprobante_id uuid NOT NULL,
  alicuota_codigo integer NOT NULL REFERENCES imp_alicuotas(codigo),
  neto_cents bigint NOT NULL,
  iva_cents bigint NOT NULL,
  FOREIGN KEY (comprobante_id,company_id) REFERENCES imp_comprobantes(id,company_id) ON DELETE CASCADE,
  UNIQUE(comprobante_id,alicuota_codigo),
  UNIQUE(id,company_id)
);

CREATE TABLE imp_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  fila integer NOT NULL CHECK (fila >= 3),
  raw jsonb NOT NULL,
  estado text NOT NULL CHECK (estado IN ('ok','duplicado','rechazado')),
  motivo text,
  comprobante_id uuid,
  FOREIGN KEY (job_id,company_id) REFERENCES imp_import_jobs(id,company_id) ON DELETE CASCADE,
  FOREIGN KEY (comprobante_id,company_id) REFERENCES imp_comprobantes(id,company_id) ON DELETE SET NULL,
  UNIQUE(job_id,fila),
  UNIQUE(id,company_id)
);

CREATE OR REPLACE FUNCTION imp_periodo_abierto(cid uuid,p_periodo text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT coalesce((SELECT estado='abierto' FROM public.imp_periodos
    WHERE company_id=cid AND periodo=p_periodo),true)
$$;
REVOKE ALL ON FUNCTION imp_periodo_abierto(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION imp_periodo_abierto(uuid,text) TO talon_app;

CREATE OR REPLACE FUNCTION imp_comprobante_periodo_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cid uuid; per text;
BEGIN
  cid:=coalesce(NEW.company_id,OLD.company_id);
  per:=coalesce(NEW.periodo,OLD.periodo);
  IF NOT imp_periodo_abierto(cid,per) THEN
    RAISE EXCEPTION 'El período % está cerrado',per USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND OLD.periodo IS DISTINCT FROM NEW.periodo
     AND NOT imp_periodo_abierto(OLD.company_id,OLD.periodo) THEN
    RAISE EXCEPTION 'El período % está cerrado',OLD.periodo USING ERRCODE='55000';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;

CREATE TRIGGER imp_comprobantes_periodo_guard
  BEFORE INSERT OR UPDATE OR DELETE ON imp_comprobantes
  FOR EACH ROW EXECUTE FUNCTION imp_comprobante_periodo_guard();

CREATE OR REPLACE FUNCTION imp_alicuota_periodo_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE row_company uuid; row_periodo text; target uuid;
BEGIN
  target:=coalesce(NEW.comprobante_id,OLD.comprobante_id);
  SELECT company_id,periodo INTO row_company,row_periodo FROM imp_comprobantes WHERE id=target;
  IF row_company IS NOT NULL AND NOT imp_periodo_abierto(row_company,row_periodo) THEN
    RAISE EXCEPTION 'El período % está cerrado',row_periodo USING ERRCODE='55000';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;

CREATE TRIGGER imp_alicuotas_periodo_guard
  BEFORE INSERT OR UPDATE OR DELETE ON imp_comprobante_alicuotas
  FOR EACH ROW EXECUTE FUNCTION imp_alicuota_periodo_guard();

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'imp_import_jobs','imp_comprobantes','imp_comprobante_alicuotas','imp_import_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (company_id=app_company_id() AND app_has_permission(''impuestos.ver''))',tbl||'_select',tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (company_id=app_company_id() AND (app_has_permission(''impuestos.crear'') OR app_has_permission(''impuestos.importar'')))',tbl||'_insert',tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (company_id=app_company_id() AND (app_has_permission(''impuestos.editar'') OR app_has_permission(''impuestos.importar''))) WITH CHECK (company_id=app_company_id() AND (app_has_permission(''impuestos.editar'') OR app_has_permission(''impuestos.importar'')))',tbl||'_update',tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (company_id=app_company_id() AND app_has_permission(''impuestos.anular''))',tbl||'_delete',tbl);
    EXECUTE format('CREATE TRIGGER lifecycle_write_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION company_write_gate()',tbl);
    EXECUTE format('CREATE TRIGGER lifecycle_statement_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION company_statement_gate()',tbl);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO talon_app',tbl);
  END LOOP;
END $$;
