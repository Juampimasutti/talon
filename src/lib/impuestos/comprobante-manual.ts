import { isValidCuit } from "@/lib/fiscal/cuit";
const TASAS:Record<number,number>={3:0,9:250,8:500,4:1050,5:2100,6:2700};
const SIN_CREDITO=new Set([6,7,8,11,12,13]);
export type AlicuotaManual={codigo:number;netoCents:number;ivaCents:number};
export type ComprobanteManual={tipoCbte:number;docTipo:number;docNro:string;alicuotas:AlicuotaManual[];noGravadoCents:number;exentoCents:number;tributosCents:number;totalCents:number;creditoFiscalCents:number};
export function validarComprobanteManual(c:ComprobanteManual,tolerancia=5){
 const errores:string[]=[];
 if(c.docTipo===80&&!isValidCuit(c.docNro))errores.push("CUIT inválido");
 const componentes=c.alicuotas.reduce((n,a)=>n+a.netoCents+a.ivaCents,0)+c.noGravadoCents+c.exentoCents+c.tributosCents;
 if(Math.abs(componentes-c.totalCents)>tolerancia)errores.push("Los componentes no coinciden con el total");
 for(const a of c.alicuotas){const bps=TASAS[a.codigo];if(bps==null)errores.push("Alícuota inexistente");else if(Math.abs(Math.round(a.netoCents*bps/10000)-a.ivaCents)>tolerancia)errores.push(`IVA incoherente para alícuota ${a.codigo}`);}
 if(SIN_CREDITO.has(c.tipoCbte)&&c.creditoFiscalCents!==0)errores.push("Los comprobantes B/C no generan crédito fiscal");
 return errores;
}
