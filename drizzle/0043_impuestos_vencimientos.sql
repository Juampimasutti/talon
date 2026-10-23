CREATE TABLE imp_vencimientos(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), obligacion text NOT NULL, periodo char(6) NOT NULL,
 terminacion_desde smallint NOT NULL CHECK(terminacion_desde between 0 and 9),
 terminacion_hasta smallint NOT NULL CHECK(terminacion_hasta between terminacion_desde and 9),
 fecha date NOT NULL, fuente_url text NOT NULL,
 UNIQUE(obligacion,periodo,terminacion_desde,terminacion_hasta)
);
INSERT INTO imp_vencimientos(obligacion,periodo,terminacion_desde,terminacion_hasta,fecha,fuente_url) VALUES
('iva_simple','202609',0,1,'2026-10-19','https://seti.afip.gob.ar/av/viewVencimientos.do'),
('iva_simple','202609',2,3,'2026-10-20','https://seti.afip.gob.ar/av/viewVencimientos.do'),
('iva_simple','202609',4,5,'2026-10-21','https://seti.afip.gob.ar/av/viewVencimientos.do'),
('iva_simple','202609',6,7,'2026-10-22','https://seti.afip.gob.ar/av/viewVencimientos.do'),
('iva_simple','202609',8,9,'2026-10-23','https://seti.afip.gob.ar/av/viewVencimientos.do'),
('lid_exento','202609',0,9,'2026-10-15','https://seti.afip.gob.ar/av/viewVencimientos.do');
GRANT SELECT ON imp_vencimientos TO talon_app;
