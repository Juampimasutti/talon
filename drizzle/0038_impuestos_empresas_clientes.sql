-- Empresas cliente del estudio. company_id sigue siendo el límite RLS del tenant;
-- empresa_cliente_id separa libros, períodos y liquidaciones dentro del estudio.
CREATE TABLE imp_empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 120),
  razon_social text NOT NULL CHECK (length(trim(razon_social)) BETWEEN 1 AND 160),
  cuit text NOT NULL CHECK (cuit ~ '^\d{11}$'),
  condicion_iva text NOT NULL,
  rubro text,
  activa boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,cuit),
  UNIQUE(id,company_id)
);

ALTER TABLE imp_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE imp_empresas FORCE ROW LEVEL SECURITY;
CREATE POLICY imp_empresas_select ON imp_empresas FOR SELECT
  USING (company_id=app_company_id() AND app_has_permission('impuestos.ver'));
CREATE POLICY imp_empresas_insert ON imp_empresas FOR INSERT
  WITH CHECK (company_id=app_company_id() AND app_has_permission('impuestos.crear'));
CREATE POLICY imp_empresas_update ON imp_empresas FOR UPDATE
  USING (company_id=app_company_id() AND app_has_permission('impuestos.editar'))
  WITH CHECK (company_id=app_company_id() AND app_has_permission('impuestos.editar'));

INSERT INTO imp_empresas(company_id,nombre,razon_social,cuit,condicion_iva,rubro)
SELECT id,name,legal_name,regexp_replace(cuit,'\D','','g'),tax_condition,business_sector
FROM companies;

CREATE OR REPLACE FUNCTION imp_crear_empresa_cliente_inicial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF current_setting('app.lifecycle_company',true)=NEW.id::text THEN RETURN NEW; END IF;
  INSERT INTO imp_empresas(company_id,nombre,razon_social,cuit,condicion_iva,rubro)
  VALUES(NEW.id,NEW.name,NEW.legal_name,regexp_replace(NEW.cuit,'\D','','g'),NEW.tax_condition,NEW.business_sector);
  RETURN NEW;
END $$;
CREATE TRIGGER companies_imp_empresa_inicial
AFTER INSERT ON companies FOR EACH ROW EXECUTE FUNCTION imp_crear_empresa_cliente_inicial();

-- Si el request eligió un cliente, se valida contra el tenant. Para instalaciones
-- migradas con un único cliente activo, ese cliente se selecciona automáticamente.
CREATE OR REPLACE FUNCTION app_imp_empresa_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE selected_id uuid; only_id uuid;
BEGIN
  BEGIN selected_id := nullif(current_setting('app.imp_empresa_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN selected_id := NULL; END;
  IF selected_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM imp_empresas WHERE id=selected_id AND company_id=app_company_id() AND activa
  ) THEN RETURN selected_id; END IF;
  SELECT (array_agg(id ORDER BY created_at,id))[1] INTO only_id FROM imp_empresas WHERE company_id=app_company_id() AND activa
  HAVING count(*)=1;
  RETURN only_id;
END $$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'imp_config','imp_puntos_venta','imp_actividades','imp_contrapartes',
    'imp_mapeo_tributos','imp_periodos','imp_import_jobs','imp_comprobantes',
    'imp_comprobante_alicuotas','imp_import_rows','imp_liquidaciones','imp_liquidacion_items'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN empresa_cliente_id uuid',tbl);
    EXECUTE format('UPDATE %I t SET empresa_cliente_id=e.id FROM imp_empresas e WHERE e.company_id=t.company_id',tbl);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN empresa_cliente_id SET NOT NULL',tbl);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN empresa_cliente_id SET DEFAULT app_imp_empresa_id()',tbl);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(empresa_cliente_id,company_id) REFERENCES imp_empresas(id,company_id) ON DELETE RESTRICT',tbl,tbl||'_empresa_cliente_fk');
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL USING (empresa_cliente_id=app_imp_empresa_id()) WITH CHECK (empresa_cliente_id=app_imp_empresa_id())',tbl||'_empresa_scope',tbl);
  END LOOP;
END $$;

-- Las identidades que antes eran únicas por tenant pasan a ser únicas por cliente.
ALTER TABLE imp_config DROP CONSTRAINT imp_config_pkey;
ALTER TABLE imp_config ADD PRIMARY KEY(company_id,empresa_cliente_id);
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conrelid::regclass AS tabla,conname FROM pg_constraint
    WHERE contype='u' AND (
      (conrelid='imp_puntos_venta'::regclass AND pg_get_constraintdef(oid)='UNIQUE (company_id, numero)') OR
      (conrelid='imp_actividades'::regclass AND pg_get_constraintdef(oid)='UNIQUE (company_id, codigo)') OR
      (conrelid='imp_contrapartes'::regclass AND pg_get_constraintdef(oid)='UNIQUE (company_id, doc_tipo, doc_nro)') OR
      (conrelid='imp_mapeo_tributos'::regclass AND pg_get_constraintdef(oid)='UNIQUE (company_id, nombre_talon)') OR
      (conrelid='imp_comprobantes'::regclass AND pg_get_constraintdef(oid)='UNIQUE (company_id, libro, doc_nro_emisor, tipo_cbte, punto_venta, numero_desde)') OR
      (conrelid='imp_liquidaciones'::regclass AND pg_get_constraintdef(oid)='UNIQUE (company_id, periodo)')
    )
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tabla,c.conname); END LOOP;
END $$;
ALTER TABLE imp_puntos_venta ADD CONSTRAINT imp_puntos_venta_empresa_numero UNIQUE(company_id,empresa_cliente_id,numero);
ALTER TABLE imp_actividades ADD CONSTRAINT imp_actividades_empresa_codigo UNIQUE(company_id,empresa_cliente_id,codigo);
ALTER TABLE imp_contrapartes ADD CONSTRAINT imp_contrapartes_empresa_documento UNIQUE(company_id,empresa_cliente_id,doc_tipo,doc_nro);
ALTER TABLE imp_mapeo_tributos ADD CONSTRAINT imp_mapeo_tributos_empresa_nombre UNIQUE(company_id,empresa_cliente_id,nombre_talon);
ALTER TABLE imp_periodos DROP CONSTRAINT imp_periodos_pkey;
ALTER TABLE imp_periodos ADD PRIMARY KEY(company_id,empresa_cliente_id,periodo);
ALTER TABLE imp_comprobantes ADD CONSTRAINT imp_comprobantes_empresa_identity UNIQUE(company_id,empresa_cliente_id,libro,doc_nro_emisor,tipo_cbte,punto_venta,numero_desde);
DROP INDEX imp_comprobantes_source;
CREATE UNIQUE INDEX imp_comprobantes_empresa_source ON imp_comprobantes(company_id,empresa_cliente_id,source_document_id) WHERE source_document_id IS NOT NULL;
ALTER TABLE imp_liquidaciones ADD CONSTRAINT imp_liquidaciones_empresa_periodo UNIQUE(company_id,empresa_cliente_id,periodo);

-- Las relaciones internas también incluyen el cliente para impedir cruces
-- accidentales entre dos empresas del mismo estudio.
ALTER TABLE imp_contrapartes ADD CONSTRAINT imp_contrapartes_id_company_empresa UNIQUE(id,company_id,empresa_cliente_id);
ALTER TABLE imp_import_jobs ADD CONSTRAINT imp_import_jobs_id_company_empresa UNIQUE(id,company_id,empresa_cliente_id);
ALTER TABLE imp_comprobantes ADD CONSTRAINT imp_comprobantes_id_company_empresa UNIQUE(id,company_id,empresa_cliente_id);
ALTER TABLE imp_liquidaciones ADD CONSTRAINT imp_liquidaciones_id_company_empresa UNIQUE(id,company_id,empresa_cliente_id);
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT child.relname AS tabla,x.conname,parent.relname AS padre
    FROM pg_constraint x JOIN pg_class child ON child.oid=x.conrelid JOIN pg_class parent ON parent.oid=x.confrelid
    WHERE x.contype='f' AND (
      (child.relname='imp_comprobantes' AND parent.relname='imp_contrapartes') OR
      (child.relname='imp_comprobante_alicuotas' AND parent.relname='imp_comprobantes') OR
      (child.relname='imp_import_rows' AND parent.relname IN ('imp_import_jobs','imp_comprobantes')) OR
      (child.relname='imp_liquidacion_items' AND parent.relname='imp_liquidaciones')
    )
  LOOP EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',c.tabla,c.conname); END LOOP;
END $$;
ALTER TABLE imp_comprobantes ADD CONSTRAINT imp_comprobantes_contraparte_empresa_fk
  FOREIGN KEY(contraparte_id,company_id,empresa_cliente_id) REFERENCES imp_contrapartes(id,company_id,empresa_cliente_id);
ALTER TABLE imp_comprobante_alicuotas ADD CONSTRAINT imp_alicuotas_comprobante_empresa_fk
  FOREIGN KEY(comprobante_id,company_id,empresa_cliente_id) REFERENCES imp_comprobantes(id,company_id,empresa_cliente_id) ON DELETE CASCADE;
ALTER TABLE imp_import_rows ADD CONSTRAINT imp_import_rows_job_empresa_fk
  FOREIGN KEY(job_id,company_id,empresa_cliente_id) REFERENCES imp_import_jobs(id,company_id,empresa_cliente_id) ON DELETE CASCADE;
ALTER TABLE imp_import_rows ADD CONSTRAINT imp_import_rows_comprobante_empresa_fk
  FOREIGN KEY(comprobante_id,company_id,empresa_cliente_id) REFERENCES imp_comprobantes(id,company_id,empresa_cliente_id) ON DELETE SET NULL (comprobante_id);
ALTER TABLE imp_liquidacion_items ADD CONSTRAINT imp_liquidacion_items_empresa_fk
  FOREIGN KEY(liquidacion_id,company_id,empresa_cliente_id) REFERENCES imp_liquidaciones(id,company_id,empresa_cliente_id) ON DELETE CASCADE;

CREATE INDEX imp_empresas_company_activa ON imp_empresas(company_id,activa,nombre);
CREATE INDEX imp_comprobantes_empresa_periodo ON imp_comprobantes(company_id,empresa_cliente_id,libro,periodo);

CREATE OR REPLACE FUNCTION imp_periodo_abierto(cid uuid,p_periodo text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT estado='abierto' FROM imp_periodos
    WHERE company_id=cid AND empresa_cliente_id=app_imp_empresa_id() AND periodo=p_periodo),true)
$$;

CREATE OR REPLACE FUNCTION imp_liquidacion_cerrar_periodo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado='confirmada' AND (TG_OP='INSERT' OR OLD.estado='borrador') THEN
    INSERT INTO imp_periodos(company_id,empresa_cliente_id,periodo,estado)
    VALUES(NEW.company_id,NEW.empresa_cliente_id,NEW.periodo,'cerrado')
    ON CONFLICT(company_id,empresa_cliente_id,periodo) DO UPDATE SET estado='cerrado',updated_at=now();
  ELSIF NEW.estado='borrador' THEN
    INSERT INTO imp_periodos(company_id,empresa_cliente_id,periodo,estado)
    VALUES(NEW.company_id,NEW.empresa_cliente_id,NEW.periodo,'abierto')
    ON CONFLICT(company_id,empresa_cliente_id,periodo) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION imp_periodo_estado_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado='cerrado' AND NEW.estado='abierto'
     AND current_setting('app.impuestos_reapertura',true) IS DISTINCT FROM 'permitida' THEN
    RAISE EXCEPTION 'El período sólo puede reabrirse mediante la reapertura auditada' USING ERRCODE='55000';
  END IF;
  IF OLD.estado='abierto' AND NEW.estado='cerrado' AND NOT EXISTS(
    SELECT 1 FROM imp_liquidaciones l WHERE l.company_id=NEW.company_id
      AND l.empresa_cliente_id=NEW.empresa_cliente_id AND l.periodo=NEW.periodo AND l.estado='confirmada'
  ) THEN RAISE EXCEPTION 'El período sólo se cierra al confirmar la liquidación' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION imp_reabrir_periodo(p_periodo text,p_motivo text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cid uuid:=public.app_company_id(); eid uuid:=public.app_imp_empresa_id(); uid uuid:=public.app_user_id(); posteriores integer;
BEGIN
  IF cid IS NULL OR eid IS NULL OR uid IS NULL OR NOT public.app_has_permission('impuestos.anular') THEN
    RAISE insufficient_privilege USING MESSAGE='Falta el permiso impuestos.anular o la empresa cliente';
  END IF;
  IF length(trim(coalesce(p_motivo,'')))<5 THEN RAISE EXCEPTION 'Indicá un motivo de al menos 5 caracteres' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.imp_periodos WHERE company_id=cid AND empresa_cliente_id=eid AND periodo=p_periodo AND estado='cerrado') THEN
    RAISE EXCEPTION 'El período no está cerrado' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO posteriores FROM public.imp_liquidaciones
    WHERE company_id=cid AND empresa_cliente_id=eid AND periodo>p_periodo AND estado='confirmada';
  PERFORM set_config('app.impuestos_reapertura','permitida',true);
  UPDATE public.imp_liquidaciones SET estado='borrador',snapshot=NULL,confirmada_por=NULL,confirmada_at=NULL,updated_at=now()
    WHERE company_id=cid AND empresa_cliente_id=eid AND periodo=p_periodo AND estado='confirmada';
  UPDATE public.imp_periodos SET estado='abierto',updated_at=now()
    WHERE company_id=cid AND empresa_cliente_id=eid AND periodo=p_periodo;
  INSERT INTO public.audit_log(company_id,user_id,action,entity,entity_id,summary,metadata)
  VALUES(cid,uid,'impuestos.reabrir','periodo',p_periodo,'Período impositivo reabierto',
    jsonb_build_object('empresaClienteId',eid,'motivo',trim(p_motivo),'liquidacionesPosteriores',posteriores,'saldoPosteriorDesactualizado',posteriores>0));
  RETURN posteriores>0;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='talon_app') THEN
    GRANT SELECT,INSERT,UPDATE ON imp_empresas TO talon_app;
    GRANT EXECUTE ON FUNCTION app_imp_empresa_id() TO talon_app;
  END IF;
END $$;
