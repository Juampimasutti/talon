CREATE POLICY business_reverse_delete ON construction_releases FOR DELETE USING(company_id=app_company_id() AND app_has_permission('constructora.anular'));
