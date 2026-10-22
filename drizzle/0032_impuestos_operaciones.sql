-- Cierre/reapertura fiscal auditados y reimportaciones idempotentes.

-- Subconjunto necesario para Mis Comprobantes, según los códigos enumerados en
-- el brief y sujeto a la validación pendiente de la tabla completa de ARCA:
-- https://www.arca.gob.ar/libro-iva-digital/documentos/
INSERT INTO imp_tipos_comprobante(codigo,descripcion,letra,clase,signo,discrimina_iva,usa_ventas,usa_compras,vigente_desde) VALUES
 (1,'Factura A','A','factura',1,true,true,true,'1990-01-01'),
 (2,'Nota de Débito A','A','nd',1,true,true,true,'1990-01-01'),
 (3,'Nota de Crédito A','A','nc',-1,true,true,true,'1990-01-01'),
 (6,'Factura B','B','factura',1,false,true,true,'1990-01-01'),
 (7,'Nota de Débito B','B','nd',1,false,true,true,'1990-01-01'),
 (8,'Nota de Crédito B','B','nc',-1,false,true,true,'1990-01-01'),
 (11,'Factura C','C','factura',1,false,true,true,'1990-01-01'),
 (12,'Nota de Débito C','C','nd',1,false,true,true,'1990-01-01'),
 (13,'Nota de Crédito C','C','nc',-1,false,true,true,'1990-01-01')
ON CONFLICT(codigo) DO NOTHING;

ALTER TABLE imp_import_jobs DROP CONSTRAINT IF EXISTS imp_import_jobs_company_id_tipo_archivo_hash_key;
CREATE INDEX imp_import_jobs_company_hash_idx ON imp_import_jobs(company_id,tipo,archivo_hash);

CREATE OR REPLACE FUNCTION imp_liquidacion_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.estado='confirmada' THEN
    RAISE EXCEPTION 'La liquidación confirmada debe reabrirse antes de eliminarse' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND OLD.estado='confirmada' AND NEW.estado='borrador'
     AND current_setting('app.impuestos_reapertura',true) IS DISTINCT FROM 'permitida' THEN
    RAISE EXCEPTION 'La liquidación confirmada sólo puede volver a borrador mediante la reapertura auditada' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND OLD.estado='confirmada' AND NEW.estado='confirmada' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'La liquidación confirmada no se puede editar' USING ERRCODE='55000';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION imp_liquidacion_cerrar_periodo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado='confirmada' AND (TG_OP='INSERT' OR OLD.estado='borrador') THEN
    INSERT INTO imp_periodos(company_id,periodo,estado)
    VALUES(NEW.company_id,NEW.periodo,'cerrado')
    ON CONFLICT(company_id,periodo) DO UPDATE SET estado='cerrado',updated_at=now();
  ELSIF NEW.estado='borrador' THEN
    INSERT INTO imp_periodos(company_id,periodo,estado)
    VALUES(NEW.company_id,NEW.periodo,'abierto')
    ON CONFLICT(company_id,periodo) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS imp_liquidacion_cerrar_periodo ON imp_liquidaciones;
CREATE TRIGGER imp_liquidacion_cerrar_periodo
  AFTER INSERT OR UPDATE OF estado ON imp_liquidaciones
  FOR EACH ROW EXECUTE FUNCTION imp_liquidacion_cerrar_periodo();

CREATE OR REPLACE FUNCTION imp_periodo_estado_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado='cerrado' AND NEW.estado='abierto'
     AND current_setting('app.impuestos_reapertura',true) IS DISTINCT FROM 'permitida' THEN
    RAISE EXCEPTION 'El período sólo puede reabrirse mediante la reapertura auditada' USING ERRCODE='55000';
  END IF;
  IF OLD.estado='abierto' AND NEW.estado='cerrado'
     AND NOT EXISTS(SELECT 1 FROM imp_liquidaciones l WHERE l.company_id=NEW.company_id AND l.periodo=NEW.periodo AND l.estado='confirmada') THEN
    RAISE EXCEPTION 'El período sólo se cierra al confirmar la liquidación' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS imp_periodo_estado_guard ON imp_periodos;
CREATE TRIGGER imp_periodo_estado_guard BEFORE UPDATE OF estado ON imp_periodos
  FOR EACH ROW EXECUTE FUNCTION imp_periodo_estado_guard();

CREATE OR REPLACE FUNCTION imp_reabrir_periodo(p_periodo text,p_motivo text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cid uuid:=public.app_company_id(); uid uuid:=public.app_user_id(); posteriores integer;
BEGIN
  IF cid IS NULL OR uid IS NULL OR NOT public.app_has_permission('impuestos.anular') THEN
    RAISE insufficient_privilege USING MESSAGE='Falta el permiso impuestos.anular';
  END IF;
  IF length(trim(coalesce(p_motivo,'')))<5 THEN
    RAISE EXCEPTION 'Indicá un motivo de al menos 5 caracteres' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.imp_periodos WHERE company_id=cid AND periodo=p_periodo AND estado='cerrado') THEN
    RAISE EXCEPTION 'El período no está cerrado' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO posteriores FROM public.imp_liquidaciones
    WHERE company_id=cid AND periodo>p_periodo AND estado='confirmada';
  PERFORM set_config('app.impuestos_reapertura','permitida',true);
  UPDATE public.imp_liquidaciones SET estado='borrador',snapshot=NULL,confirmada_por=NULL,
    confirmada_at=NULL,updated_at=now() WHERE company_id=cid AND periodo=p_periodo AND estado='confirmada';
  UPDATE public.imp_periodos SET estado='abierto',updated_at=now() WHERE company_id=cid AND periodo=p_periodo;
  INSERT INTO public.audit_log(company_id,user_id,action,entity,entity_id,summary,metadata)
  VALUES(cid,uid,'impuestos.reabrir','periodo',p_periodo,'Período impositivo reabierto',
    jsonb_build_object('motivo',trim(p_motivo),'liquidacionesPosteriores',posteriores,
      'saldoPosteriorDesactualizado',posteriores>0));
  RETURN posteriores>0;
END $$;
REVOKE ALL ON FUNCTION imp_reabrir_periodo(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION imp_reabrir_periodo(text,text) TO talon_app;
