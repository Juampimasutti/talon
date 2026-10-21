-- No se eliminan ni fusionan empresas preexistentes con el mismo CUIT.
CREATE INDEX IF NOT EXISTS companies_cuit_lookup ON companies ((regexp_replace(cuit,'[^0-9]','','g')));
CREATE TABLE company_legacy_cuits AS
 SELECT id,cuit FROM (SELECT id,regexp_replace(cuit,'[^0-9]','','g') AS cuit,
 count(*) OVER (PARTITION BY regexp_replace(cuit,'[^0-9]','','g')) AS copies FROM companies) historical WHERE copies>1;
REVOKE ALL ON company_legacy_cuits FROM PUBLIC,talon_app;
CREATE FUNCTION company_cuit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE normalized text;
BEGIN
 normalized:=regexp_replace(NEW.cuit,'[^0-9]','','g');
 IF TG_OP='UPDATE' AND normalized=regexp_replace(OLD.cuit,'[^0-9]','','g') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(normalized,260028));
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.company_legacy_cuits WHERE id=NEW.id AND cuit=normalized) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.companies WHERE regexp_replace(cuit,'[^0-9]','','g')=normalized AND id<>NEW.id) THEN
   RAISE unique_violation USING MESSAGE='companies_cuit: Ya existe una empresa con ese CUIT';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER companies_cuit_guard BEFORE INSERT OR UPDATE OF cuit ON companies FOR EACH ROW EXECUTE FUNCTION company_cuit_guard();
-- Cuando no hay duplicados históricos, reforzar también con unicidad declarativa.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM companies GROUP BY regexp_replace(cuit,'[^0-9]','','g') HAVING count(*)>1) THEN
  CREATE UNIQUE INDEX companies_cuit_unique ON companies ((regexp_replace(cuit,'[^0-9]','','g')));
 ELSE
  RAISE NOTICE 'CUIT históricos repetidos: se conservan; el trigger impide nuevas duplicaciones';
 END IF;
END $$;
