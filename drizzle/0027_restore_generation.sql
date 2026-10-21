-- La generación de recuperación no depende del reloj del dispositivo offline.
CREATE FUNCTION company_restore_version() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT id FROM public.company_lifecycle_events WHERE target_id=public.app_company_id() AND action='restaurar' ORDER BY created_at DESC,id DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION company_restore_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_restore_version() TO talon_app;
