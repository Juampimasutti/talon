CREATE TABLE imp_retenciones_percepciones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 empresa_cliente_id uuid NOT NULL DEFAULT app_imp_empresa_id(),
 tipo text NOT NULL CHECK(tipo IN ('retencion','percepcion')),
 regimen text NOT NULL, agente_cuit text NOT NULL CHECK(agente_cuit ~ '^\d{11}$'),
 agente_denominacion text NOT NULL, fecha date NOT NULL, numero_certificado text NOT NULL,
 importe_cents bigint NOT NULL CHECK(importe_cents>0), periodo_origen char(6) NOT NULL,
 periodo_computo char(6) NOT NULL, comprobante_id uuid, origen text NOT NULL DEFAULT 'manual',
 estado text NOT NULL DEFAULT 'vigente' CHECK(estado IN ('vigente','anulado')),
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(empresa_cliente_id,company_id) REFERENCES imp_empresas(id,company_id) ON DELETE RESTRICT,
 FOREIGN KEY(comprobante_id,company_id) REFERENCES imp_comprobantes(id,company_id) ON DELETE RESTRICT,
 UNIQUE(company_id,empresa_cliente_id,tipo,agente_cuit,numero_certificado)
);
ALTER TABLE imp_retenciones_percepciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE imp_retenciones_percepciones FORCE ROW LEVEL SECURITY;
CREATE POLICY imp_rp_select ON imp_retenciones_percepciones FOR SELECT USING(company_id=app_company_id() AND app_has_permission('impuestos.ver'));
CREATE POLICY imp_rp_insert ON imp_retenciones_percepciones FOR INSERT WITH CHECK(company_id=app_company_id() AND app_has_permission('impuestos.crear'));
CREATE POLICY imp_rp_update ON imp_retenciones_percepciones FOR UPDATE USING(company_id=app_company_id() AND app_has_permission('impuestos.editar')) WITH CHECK(company_id=app_company_id() AND app_has_permission('impuestos.editar'));
CREATE POLICY imp_rp_delete ON imp_retenciones_percepciones FOR DELETE USING(company_id=app_company_id() AND app_has_permission('impuestos.anular'));
CREATE POLICY imp_rp_empresa_scope ON imp_retenciones_percepciones AS RESTRICTIVE FOR ALL USING(empresa_cliente_id=app_imp_empresa_id()) WITH CHECK(empresa_cliente_id=app_imp_empresa_id());
CREATE INDEX imp_rp_periodo ON imp_retenciones_percepciones(company_id,empresa_cliente_id,periodo_computo,estado);
GRANT SELECT,INSERT,UPDATE,DELETE ON imp_retenciones_percepciones TO talon_app;
