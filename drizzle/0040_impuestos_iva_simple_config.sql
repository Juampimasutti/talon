ALTER TABLE imp_config
  ADD COLUMN esquema_iva text NOT NULL DEFAULT 'iva_simple',
  ADD COLUMN iva_simple_desde char(6) DEFAULT '202511',
  ADD CONSTRAINT imp_config_esquema_iva_check CHECK(esquema_iva IN ('iva_simple','f2002_lid')),
  ADD CONSTRAINT imp_config_iva_simple_desde_check CHECK(iva_simple_desde IS NULL OR iva_simple_desde ~ '^(20|21)[0-9]{2}(0[1-9]|1[0-2])$');
