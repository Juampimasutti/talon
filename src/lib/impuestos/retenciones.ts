import { periodoSchema } from "./periodo";

export function sumarMeses(periodo: string, meses: number) {
  periodoSchema.parse(periodo);
  const year = Number(periodo.slice(0,4)); const month = Number(periodo.slice(4,6));
  const index = year * 12 + month - 1 + meses;
  return `${Math.floor(index/12)}${String(index%12+1).padStart(2,"0")}`;
}

export function validarPeriodoComputo(tipo: "retencion"|"percepcion", origen: string, computo: string) {
  periodoSchema.parse(origen); periodoSchema.parse(computo);
  if (tipo === "retencion" && computo !== origen) return "Las retenciones se computan en el período de origen";
  if (tipo === "percepcion" && (computo < origen || computo > sumarMeses(origen,5))) return "Las percepciones se computan en el período de origen o en alguno de los cinco siguientes";
  return null;
}
