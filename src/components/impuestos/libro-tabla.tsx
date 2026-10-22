import { formatMoney } from "@/lib/format";

export type LibroItem={id:string;fecha_cbte:string;tipo_cbte:number;tipo_descripcion?:string;letra?:string|null;signo?:number;punto_venta:number;numero_desde:string;doc_nro:string;denominacion:string;
 neto_no_gravado_cents:string;exento_cents:string;percep_iva_cents:string;percep_otros_nac_cents:string;percep_iibb_cents:string;percep_municipales_cents:string;impuestos_internos_cents:string;otros_tributos_cents:string;
 total_cents:string;estado:string;alicuotas:{codigo:number;netoCents:number|string;ivaCents:number|string}[]};

const ALICUOTAS:Record<number,string>={3:"0%",4:"10,5%",5:"21%",6:"27%",8:"5%",9:"2,5%"};
const n=(v:unknown)=>Number(v??0)||0;
const otros=(i:LibroItem)=>n(i.percep_otros_nac_cents)+n(i.percep_iibb_cents)+n(i.percep_municipales_cents)+n(i.impuestos_internos_cents)+n(i.otros_tributos_cents);

/** Libro IVA legible: neto e IVA por alícuota, conceptos no gravados, percepciones y totales (las NC restan). */
export function LibroTabla({items}:{items:LibroItem[]}){
 const vigentes=items.filter(i=>i.estado!=="anulado");
 const codigos=[...new Set(items.flatMap(i=>i.alicuotas.map(a=>a.codigo)))].sort((a,b)=>a-b);
 const sum=(f:(i:LibroItem)=>number)=>vigentes.reduce((t,i)=>t+f(i)*(i.signo??1),0);
 const alic=(i:LibroItem,c:number,k:"netoCents"|"ivaCents")=>i.alicuotas.filter(a=>a.codigo===c).reduce((t,a)=>t+n(a[k]),0);
 const money=(cents:number)=>cents?formatMoney(cents):"—";
 const cell="px-2 py-1 text-right tabular-nums whitespace-nowrap";
 return <div className="overflow-x-auto rounded border"><table className="w-full text-xs sm:text-sm">
  <thead><tr className="bg-muted text-left"><th className="p-2">Fecha</th><th className="p-2">Comprobante</th><th className="p-2">Contraparte</th>
   {codigos.map(c=><th key={c} className={cell} colSpan={1}>Neto {ALICUOTAS[c]??c}</th>)}
   {codigos.map(c=><th key={`i${c}`} className={cell}>IVA {ALICUOTAS[c]??c}</th>)}
   <th className={cell}>No grav./Exento</th><th className={cell}>Percep. IVA</th><th className={cell}>Otros tributos</th><th className={`${cell} sticky right-0 bg-muted shadow-[-1px_0_0_hsl(var(--border))]`}>Total</th></tr></thead>
  <tbody>{items.map(i=>{const s=i.signo??1;const anul=i.estado==="anulado";return <tr key={i.id} className={`border-t ${anul?"text-muted-foreground line-through":""}`}>
   <td className="p-2 whitespace-nowrap">{String(i.fecha_cbte).slice(0,10).split("-").reverse().join("/")}</td>
   <td className="p-2 whitespace-nowrap">{i.tipo_descripcion??i.tipo_cbte} {String(i.punto_venta).padStart(5,"0")}-{String(i.numero_desde).padStart(8,"0")}</td>
   <td className="p-2 whitespace-nowrap">{i.denominacion}<div className="text-muted-foreground">{i.doc_nro&&i.doc_nro!=="0"?i.doc_nro:"Sin documento (99)"}</div></td>
   {codigos.map(c=><td key={c} className={cell}>{money(s*alic(i,c,"netoCents"))}</td>)}
   {codigos.map(c=><td key={`i${c}`} className={cell}>{money(s*alic(i,c,"ivaCents"))}</td>)}
   <td className={cell}>{money(s*(n(i.neto_no_gravado_cents)+n(i.exento_cents)))}</td><td className={cell}>{money(s*n(i.percep_iva_cents))}</td><td className={cell}>{money(s*otros(i))}</td><td className={`${cell} sticky right-0 bg-card font-medium shadow-[-1px_0_0_hsl(var(--border))]`}>{money(s*n(i.total_cents))}</td></tr>;})}
  {items.length===0?<tr><td className="p-4 text-center text-muted-foreground" colSpan={7+codigos.length*2}>No hay comprobantes en el período.</td></tr>:null}</tbody>
  {items.length?<tfoot><tr className="border-t-2 bg-muted font-semibold"><td className="p-2" colSpan={3}>Totales ({vigentes.length} comprobantes)</td>
   {codigos.map(c=><td key={c} className={cell}>{money(sum(i=>alic(i,c,"netoCents")))}</td>)}
   {codigos.map(c=><td key={`i${c}`} className={cell}>{money(sum(i=>alic(i,c,"ivaCents")))}</td>)}
   <td className={cell}>{money(sum(i=>n(i.neto_no_gravado_cents)+n(i.exento_cents)))}</td><td className={cell}>{money(sum(i=>n(i.percep_iva_cents)))}</td><td className={cell}>{money(sum(otros))}</td><td className={`${cell} sticky right-0 bg-muted shadow-[-1px_0_0_hsl(var(--border))]`}>{money(sum(i=>n(i.total_cents)))}</td></tr></tfoot>:null}
 </table></div>;
}
