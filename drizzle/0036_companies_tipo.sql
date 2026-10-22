-- Modo de la empresa: 'negocio' (lo de siempre) o 'estudio' (estudio contable,
-- sólo Impuestos). Las empresas existentes quedan como 'negocio' sin cambios.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'negocio';
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_tipo_check;
ALTER TABLE companies ADD CONSTRAINT companies_tipo_check CHECK (tipo IN ('negocio','estudio'));
