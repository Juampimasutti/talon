CREATE TABLE imp_retenciones_practicadas(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 empresa_cliente_id uuid NOT NULL DEFAULT app_imp_empresa_id(), tipo text NOT NULL CHECK(tipo IN ('retencion','percepcion')),
 sujeto_cuit text NOT NULL CHECK(sujeto_cuit ~ '^\d{11}$'), sujeto_denominacion text NOT NULL, regimen text NOT NULL,
 base_cents bigint NOT NULL CHECK(base_cents>=0), alicuota_bps integer NOT NULL CHECK(alicuota_bps>=0),
 importe_cents bigint NOT NULL CHECK(importe_cents>=0), fecha date NOT NULL, comprobante_id uuid,
 numero_certificado text NOT NULL, estado text NOT NULL DEFAULT 'vigente' CHECK(estado IN ('vigente','anulado')),
 created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(empresa_cliente_id,company_id) REFERENCES imp_empresas(id,company_id) ON DELETE RESTRICT,
 FOREIGN KEY(comprobante_id,company_id) REFERENCES imp_comprobantes(id,company_id) ON DELETE RESTRICT,
 UNIQUE(company_id,empresa_cliente_id,tipo,numero_certificado)
);
ALTER TABLE imp_retenciones_practicadas ENABLE ROW LEVEL SECURITY;ALTER TABLE imp_retenciones_practicadas FORCE ROW LEVEL SECURITY;
CREATE POLICY imp_practicadas_select ON imp_retenciones_practicadas FOR SELECT USING(company_id=app_company_id() AND app_has_permission('impuestos.ver'));
CREATE POLICY imp_practicadas_insert ON imp_retenciones_practicadas FOR INSERT WITH CHECK(company_id=app_company_id() AND app_has_permission('impuestos.crear'));
CREATE POLICY imp_practicadas_update ON imp_retenciones_practicadas FOR UPDATE USING(company_id=app_company_id() AND app_has_permission('impuestos.editar')) WITH CHECK(company_id=app_company_id() AND app_has_permission('impuestos.editar'));
CREATE POLICY imp_practicadas_empresa_scope ON imp_retenciones_practicadas AS RESTRICTIVE FOR ALL USING(empresa_cliente_id=app_imp_empresa_id()) WITH CHECK(empresa_cliente_id=app_imp_empresa_id());
GRANT SELECT,INSERT,UPDATE ON imp_retenciones_practicadas TO talon_app;
