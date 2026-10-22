export type EmpresaImpositiva = { id:string; nombre:string; razonSocial:string; cuit:string; condicionIva:string; rubro:string|null; activa:boolean };
export type EmpresaImpositivaDetalle = { empresa:EmpresaImpositiva; counts:{compras:number;ventas:number;periodos:number;liquidaciones:number}; seccion:string|null };
export const SECCIONES_IMPUESTOS = [
  {key:"compras",label:"Compras",description:"Comprobantes recibidos e importaciones."},
  {key:"ventas",label:"Ventas",description:"Comprobantes emitidos e importaciones."},
  {key:"libro-iva",label:"Libro de IVA",description:"Libros de ventas y compras por período."},
  {key:"liquidacion",label:"Liquidación",description:"Liquidación mensual de IVA."},
  {key:"configuracion",label:"Configuración",description:"Datos y criterios fiscales de la empresa."},
] as const;
export type SeccionImpuestos=(typeof SECCIONES_IMPUESTOS)[number]["key"];
