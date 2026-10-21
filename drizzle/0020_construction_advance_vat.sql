ALTER TABLE construction_certificates ADD COLUMN fiscal_version integer NOT NULL DEFAULT 1;
ALTER TABLE construction_certificates ALTER COLUMN fiscal_version SET DEFAULT 2;
ALTER TABLE construction_advances ADD COLUMN invoice_id uuid REFERENCES documents(id);
ALTER TABLE construction_releases ALTER COLUMN invoice_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION construction_document_is_linked(doc_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.construction_certificates WHERE company_id=public.app_company_id() AND invoice_id=doc_id)
 OR EXISTS(SELECT 1 FROM public.construction_advances WHERE company_id=public.app_company_id() AND (receipt_id=doc_id OR invoice_id=doc_id))
 OR EXISTS(SELECT 1 FROM public.construction_collections WHERE company_id=public.app_company_id() AND receipt_id=doc_id)
 OR EXISTS(SELECT 1 FROM public.construction_releases WHERE company_id=public.app_company_id() AND invoice_id=doc_id)
 OR EXISTS(SELECT 1 FROM public.construction_installment_receipts WHERE company_id=public.app_company_id() AND receipt_id=doc_id)
$$;
