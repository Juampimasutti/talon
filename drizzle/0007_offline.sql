CREATE TABLE idempotency_keys (
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  key text NOT NULL,
  user_id uuid,
  kind text NOT NULL,
  status text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

CREATE TABLE sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id uuid,
  op_key text NOT NULL,
  kind text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY;

CREATE POLICY idempotency_keys_select ON idempotency_keys FOR SELECT
  USING (company_id = app_company_id());
CREATE POLICY idempotency_keys_insert ON idempotency_keys FOR INSERT
  WITH CHECK (company_id = app_company_id() AND (
    app_has_permission('estacion.crear') OR app_has_permission('reparto.crear') OR app_has_permission('ventas.crear')
  ));

CREATE POLICY sync_conflicts_select ON sync_conflicts FOR SELECT
  USING (company_id = app_company_id());
CREATE POLICY sync_conflicts_insert ON sync_conflicts FOR INSERT
  WITH CHECK (company_id = app_company_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talon_app') THEN
    GRANT SELECT, INSERT ON idempotency_keys, sync_conflicts TO talon_app;
  END IF;
END $$;
