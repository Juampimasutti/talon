-- Condición fiscal validada para cada cliente del estudio.
INSERT INTO audit_log(company_id,user_id,action,entity,entity_id,summary,metadata)
SELECT company_id,NULL,'impuestos.empresa.condicion_normalizada','imp_empresa',id::text,
  'Condición de IVA inválida normalizada a responsable inscripto',
  jsonb_build_object('valor_anterior',condicion_iva,'valor_nuevo','ri')
FROM imp_empresas
WHERE condicion_iva NOT IN ('ri','monotributo','exento','cf','no_alcanzado');

UPDATE imp_empresas SET condicion_iva='ri',updated_at=now()
WHERE condicion_iva NOT IN ('ri','monotributo','exento','cf','no_alcanzado');

ALTER TABLE imp_empresas ADD CONSTRAINT imp_empresas_condicion_iva_check
  CHECK(condicion_iva IN ('ri','monotributo','exento','cf','no_alcanzado'));

CREATE OR REPLACE FUNCTION imp_crear_empresa_cliente_inicial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE condicion text;
BEGIN
  IF current_setting('app.lifecycle_company',true)=NEW.id::text THEN RETURN NEW; END IF;
  condicion := CASE lower(coalesce(NEW.tax_condition,''))
    WHEN 'ri' THEN 'ri' WHEN 'responsable_inscripto' THEN 'ri'
    WHEN 'monotributo' THEN 'monotributo' WHEN 'exento' THEN 'exento'
    WHEN 'cf' THEN 'cf' WHEN 'consumidor_final' THEN 'cf'
    WHEN 'no_alcanzado' THEN 'no_alcanzado' ELSE 'ri' END;
  INSERT INTO imp_empresas(company_id,nombre,razon_social,cuit,condicion_iva,rubro)
  VALUES(NEW.id,NEW.name,NEW.legal_name,regexp_replace(NEW.cuit,'\D','','g'),condicion,NEW.business_sector);
  RETURN NEW;
END $$;
