ALTER TABLE imp_comprobantes ADD COLUMN destino_credito text NOT NULL DEFAULT 'directo_gravado'
  CHECK(destino_credito IN ('directo_gravado','directo_exento','prorratea'));
ALTER TABLE imp_config ADD COLUMN coeficiente_prorrateo_bps integer
  CHECK(coeficiente_prorrateo_bps IS NULL OR coeficiente_prorrateo_bps BETWEEN 0 AND 10000);
