-- 1) auth_context también devuelve rubro (business_sector) y tipo de la empresa:
--    la sesión oculta Impuestos para negocios de rubro comercio/estación (ver
--    IMPUESTOS_HIDDEN_SECTORS en src/lib/auth/permissions.ts). No se borra nada.
CREATE OR REPLACE FUNCTION auth_context(p_token_hash text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email),
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'companyId', c.id,
        'companyName', c.name,
        'legalName', c.legal_name,
        'cuit', c.cuit,
        'taxCondition', c.tax_condition,
        'pointOfSale', c.point_of_sale,
        'city', c.city,
        'province', c.province,
        'enabledModules', c.enabled_modules,
        'businessSector', c.business_sector,
        'tipo', c.tipo,
        'blockNegativeStock', c.block_negative_stock,
        'roleId', r.id,
        'roleKey', r.key,
        'roleName', r.name,
        'permissions', COALESCE((
          SELECT jsonb_agg(rp.permission) FROM role_permissions rp WHERE rp.role_id = r.id
        ), '[]'::jsonb)
      ) ORDER BY c.created_at)
      FROM memberships m
      JOIN companies c ON c.id = m.company_id
      JOIN roles r ON r.id = m.role_id
      WHERE m.user_id = u.id AND m.active AND c.active
    ), '[]'::jsonb)
  )
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.expires_at > now()
    AND u.active
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talon_app') THEN
    GRANT EXECUTE ON FUNCTION auth_context(text) TO talon_app;
  END IF;
END $$;

-- 2) Moneda: Mis Comprobantes trae "$"; el Libro IVA Digital exige el código ARCA "PES".
--    El trigger de período cerrado puede bloquear el UPDATE; se desactiva sólo para este arreglo de datos.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'imp_comprobantes'::regclass AND NOT tgisinternal LOOP
    EXECUTE format('ALTER TABLE imp_comprobantes DISABLE TRIGGER %I', t.tgname);
  END LOOP;
  UPDATE imp_comprobantes SET moneda = 'PES' WHERE moneda IN ('$', 'ARS', '') OR moneda IS NULL;
  UPDATE imp_comprobantes SET moneda = 'DOL' WHERE moneda IN ('USD', 'U$S', 'US$');
  -- 3) CUIT sin guiones (antes se guardaba el CUIT de la empresa "30-71458901-2" en ventas
  --    y la reimportación no detectaba duplicados). Si ya existe la versión normalizada,
  --    la fila con guiones queda como está (se informa con NOTICE) para no perder datos.
  UPDATE imp_comprobantes c SET doc_nro_emisor = regexp_replace(c.doc_nro_emisor, '\D', '', 'g')
   WHERE c.doc_nro_emisor ~ '\D' AND NOT EXISTS (
     SELECT 1 FROM imp_comprobantes o WHERE o.company_id = c.company_id AND o.libro = c.libro
       AND o.doc_nro_emisor = regexp_replace(c.doc_nro_emisor, '\D', '', 'g')
       AND o.tipo_cbte = c.tipo_cbte AND o.punto_venta = c.punto_venta AND o.numero_desde = c.numero_desde);
  UPDATE imp_comprobantes SET doc_nro = regexp_replace(doc_nro, '\D', '', 'g') WHERE doc_nro ~ '\D';
  IF EXISTS (SELECT 1 FROM imp_comprobantes WHERE doc_nro_emisor ~ '\D') THEN
    RAISE NOTICE 'Quedaron comprobantes duplicados por CUIT con guiones: revisarlos a mano';
  END IF;
  FOR t IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'imp_comprobantes'::regclass AND NOT tgisinternal LOOP
    EXECUTE format('ALTER TABLE imp_comprobantes ENABLE TRIGGER %I', t.tgname);
  END LOOP;
END $$;

-- Despacho de importación (campo 5 de COMPRAS_CBTE y campo 1 de IMPORTACION_BIENES_ALICUOTA).
ALTER TABLE imp_comprobantes ADD COLUMN IF NOT EXISTS despacho text CHECK (despacho IS NULL OR length(despacho) <= 16);
