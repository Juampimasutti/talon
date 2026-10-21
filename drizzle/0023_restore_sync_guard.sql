CREATE FUNCTION company_restore_cutoff() RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT max(created_at) FROM public.company_lifecycle_events WHERE target_id=public.app_company_id() AND action='restaurar'
$$;
REVOKE ALL ON FUNCTION company_restore_cutoff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_restore_cutoff() TO talon_app;
