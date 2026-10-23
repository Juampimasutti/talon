export type EmpresaImpositiva = { id:string; nombre:string; razonSocial:string; cuit:string; condicionIva:string; rubro:string|null; activa:boolean };
export type EmpresaImpositivaDetalle = { empresa:EmpresaImpositiva; counts:{compras:number;ventas:number;periodos:number;liquidaciones:number}; seccion:string|null; config:{toleranciaCents:number;crearEnTalonDefault:boolean;esquemaIva:"iva_simple"|"f2002_lid";ivaSimpleDesde:string|null;coeficienteProrrateoBps:number|null}; puntosVenta:{numero:number;sistema:string}[]; actividades:{codigo:string;descripcion:string;principal:boolean}[]; vencimientos:{obligacion:string;periodo:string;fecha:string}[] };
export const SECCIONES_IMPUESTOS = [
  {key:"compras",label:"Compras",description:"Comprobantes recibidos e importaciones."},
  {key:"ventas",label:"Ventas",description:"Comprobantes emitidos e importaciones."},
  {key:"libro-iva",label:"Libro de IVA",description:"Libros de ventas y compras por período."},
  {key:"liquidacion",label:"Liquidación",description:"Liquidación mensual de IVA."},
  {key:"configuracion",label:"Configuración",description:"Datos y criterios fiscales de la empresa."},
  {key:"certificados",label:"Retenciones y percepciones",description:"Certificados sufridos y período de cómputo."},
  {key:"carga-ventas",label:"Carga manual de ventas",description:"Alta manual de comprobantes emitidos."},
  {key:"carga-compras",label:"Carga manual de compras",description:"Alta manual de comprobantes recibidos."},
] as const;
export type SeccionImpuestos=(typeof SECCIONES_IMPUESTOS)[number]["key"];
