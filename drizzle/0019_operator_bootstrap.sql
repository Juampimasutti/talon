-- Un operador autorizado puede crear la primera empresa o volver a empezar tras
-- eliminar la última. No se concede este permiso a todos los administradores.
CREATE FUNCTION company_user_is_operator(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_operators o JOIN public.users u ON u.id=o.user_id WHERE o.user_id=uid AND u.active)
$$;
REVOKE ALL ON FUNCTION company_user_is_operator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_user_is_operator(uuid) TO talon_app;
-- Las consultas y agregaciones de ambos rubros siempre filtran por empresa.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['estate_properties','estate_contracts','estate_adjustments','estate_charges','estate_receipts','estate_settlements','estate_attachments','estate_sales','construction_works','construction_items','construction_certificates','construction_certificate_lines','construction_advances','construction_collections','construction_releases','construction_subcontracts','construction_subcertificates','construction_costs','construction_transfers','construction_units','construction_unit_contracts','construction_installments','construction_installment_receipts','construction_installment_adjustments'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0] WHERE i.indrelid=to_regclass('public.'||tbl) AND a.attname='company_id') THEN
   EXECUTE format('CREATE INDEX %I ON public.%I(company_id)',tbl||'_tenant_idx',tbl);
  END IF;
 END LOOP;
END $$;
