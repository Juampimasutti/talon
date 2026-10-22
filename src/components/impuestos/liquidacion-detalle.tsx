import { formatMoney } from "@/lib/format";

export type ItemLiquidacion={rubro:string;concepto:string;importeCents:number;origen:"calculado"|"manual"};
const SECCIONES:[string,string][]=[["debito","Débito fiscal"],["credito","Crédito fiscal"],["saldo_tecnico","Saldo técnico"],["libre","Saldo de libre disponibilidad"],["resultado","Resultado"]];

/** Liquidación como formulario: secciones del F.2002 con importes en pesos. */
export function LiquidacionDetalle({items}:{items:ItemLiquidacion[]}){
 return <div className="max-w-2xl space-y-3">{SECCIONES.map(([rubro,titulo])=>{const rows=items.filter(i=>i.rubro===rubro);if(!rows.length)return null;
  return <section key={rubro} className="rounded border"><h3 className="bg-muted px-3 py-2 text-sm font-semibold">{titulo}</h3><dl className="divide-y text-sm">
   {rows.map(i=><div key={i.concepto} className={`flex justify-between gap-4 px-3 py-2 ${rubro==="resultado"&&i.importeCents?"font-semibold":""}`}><dt>{i.concepto}{i.origen==="manual"?<span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-800">cargado a mano</span>:null}</dt><dd className="tabular-nums">{formatMoney(i.importeCents)}</dd></div>)}
  </dl></section>;})}</div>;
}
