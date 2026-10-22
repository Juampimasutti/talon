-- Módulo Impuestos, etapa 1: referencias y configuración por empresa.
-- Fuentes oficiales:
--   https://www.arca.gob.ar/libro-iva-digital/documentos/
--   https://www.arca.gob.ar/ws/documentacion/manuales.asp
-- El 22/10/2026 el entorno de desarrollo recibió HTTP 403 de ARCA. Por eso
-- sólo se carga la tabla de alícuotas verificada en el brief; condiciones IVA,
-- comprobantes, operaciones, monedas y documentos quedan vacíos hasta poder
-- transcribir y revisar sus tablas oficiales completas.

CREATE TABLE imp_condiciones_iva (
  codigo integer PRIMARY KEY,
  descripcion text NOT NULL,
  talon_tax_condition text,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE TABLE imp_tipos_comprobante (
  codigo integer PRIMARY KEY CHECK (codigo BETWEEN 0 AND 999),
  descripcion text NOT NULL,
  letra text,
  clase text NOT NULL CHECK (clase IN ('factura','nd','nc','recibo','ticket','despacho','otro')),
  signo smallint NOT NULL CHECK (signo IN (-1,1)),
  discrimina_iva boolean NOT NULL,
  usa_ventas boolean NOT NULL,
  usa_compras boolean NOT NULL,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE TABLE imp_alicuotas (
  codigo integer PRIMARY KEY,
  bps integer NOT NULL UNIQUE CHECK (bps >= 0 AND bps <= 10000),
  descripcion text NOT NULL
);

COMMENT ON TABLE imp_alicuotas IS
  'Tabla Alícuotas del Libro IVA Digital: https://www.arca.gob.ar/libro-iva-digital/documentos/';

INSERT INTO imp_alicuotas(codigo,bps,descripcion) VALUES
  (3,0,'0%'),
  (4,1050,'10,5%'),
  (5,2100,'21%'),
  (6,2700,'27%'),
  (8,500,'5%'),
  (9,250,'2,5%');

CREATE TABLE imp_codigos_operacion (
  codigo text PRIMARY KEY,
  descripcion text NOT NULL,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE TABLE imp_monedas (
  codigo text PRIMARY KEY,
  descripcion text NOT NULL,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE TABLE imp_tipos_documento (
  codigo integer PRIMARY KEY,
  descripcion text NOT NULL,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE TABLE imp_matriz_letras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cond_emisor integer NOT NULL REFERENCES imp_condiciones_iva(codigo),
  cond_receptor integer NOT NULL REFERENCES imp_condiciones_iva(codigo),
  letras_permitidas text[] NOT NULL,
  norma text NOT NULL,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  CHECK (cardinality(letras_permitidas) > 0),
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  UNIQUE(cond_emisor,cond_receptor,vigente_desde)
);

CREATE TABLE imp_config (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  tolerancia_cents bigint NOT NULL DEFAULT 5 CHECK (tolerancia_cents BETWEEN 0 AND 10000),
  crear_en_talon_default boolean NOT NULL DEFAULT false,
  prorratea_default boolean NOT NULL DEFAULT false,
  modo_prorrateo_default text NOT NULL DEFAULT 'global'
    CHECK (modo_prorrateo_default IN ('global','por_comprobante','ambos')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE imp_puntos_venta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  numero integer NOT NULL CHECK (numero BETWEEN 1 AND 99999),
  sistema text NOT NULL CHECK (sistema IN ('factura_linea','web_service','controlador_fiscal','manual')),
  activo boolean NOT NULL DEFAULT true,
  UNIQUE(company_id,numero),
  UNIQUE(id,company_id)
);

CREATE TABLE imp_actividades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  descripcion text NOT NULL,
  principal boolean NOT NULL DEFAULT false,
  UNIQUE(company_id,codigo),
  UNIQUE(id,company_id)
);

CREATE UNIQUE INDEX imp_actividades_principal
  ON imp_actividades(company_id) WHERE principal;

CREATE TABLE imp_contrapartes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_tipo integer NOT NULL,
  doc_nro text NOT NULL,
  denominacion text NOT NULL,
  condicion_iva integer,
  condicion_a_revisar boolean NOT NULL DEFAULT false,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (condicion_iva) REFERENCES imp_condiciones_iva(codigo),
  UNIQUE(company_id,doc_tipo,doc_nro),
  UNIQUE(id,company_id)
);

CREATE TABLE imp_mapeo_tributos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre_talon text NOT NULL,
  destino text NOT NULL CHECK (destino IN ('percep_iva','percep_iibb','percep_muni','internos','otros')),
  UNIQUE(company_id,nombre_talon),
  UNIQUE(id,company_id)
);

CREATE TABLE imp_periodos (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  periodo text NOT NULL CHECK (periodo ~ '^[0-9]{6}$' AND substring(periodo,5,2) BETWEEN '01' AND '12'),
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  prorratea boolean NOT NULL DEFAULT false,
  modo_prorrateo text NOT NULL DEFAULT 'global' CHECK (modo_prorrateo IN ('global','por_comprobante','ambos')),
  coeficiente_bps integer CHECK (coeficiente_bps BETWEEN 0 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,periodo)
);

-- Referencias globales: cualquier sesión de la app puede leer; sólo la
-- conexión administrativa de migraciones puede escribir.
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'imp_condiciones_iva','imp_tipos_comprobante','imp_alicuotas',
    'imp_codigos_operacion','imp_monedas','imp_tipos_documento','imp_matriz_letras'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (app_user_id() IS NOT NULL)',tbl||'_select',tbl);
    EXECUTE format('GRANT SELECT ON %I TO talon_app',tbl);
  END LOOP;
END $$;

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'imp_config','imp_puntos_venta','imp_actividades','imp_contrapartes',
    'imp_mapeo_tributos','imp_periodos'
  ] LOOP
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

-- Los roles existentes conservan su intención: administración recibe todas las
-- acciones y contador sólo consulta/exporta. El módulo sigue apagado hasta que
-- la empresa agregue "impuestos" a enabled_modules.
INSERT INTO role_permissions(role_id,permission)
SELECT r.id,p.permission
FROM roles r
CROSS JOIN (VALUES
  ('impuestos.ver'),('impuestos.crear'),('impuestos.editar'),
  ('impuestos.anular'),('impuestos.importar'),('impuestos.exportar')
) p(permission)
WHERE r.is_system AND r.key='admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission)
SELECT r.id,p.permission
FROM roles r
CROSS JOIN (VALUES ('impuestos.ver'),('impuestos.exportar')) p(permission)
WHERE r.is_system AND r.key='contador'
ON CONFLICT DO NOTHING;
