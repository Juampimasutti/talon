"use client";
import { useEffect, useState } from "react";
import { apiSend } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";

type Item={id:string;fecha_cbte:string;tipo_cbte:number;punto_venta:number;numero_desde:string;denominacion:string;total_cents:string;estado:string};
const current=()=>new Date().toISOString().slice(0,7).replace("-","");
export function LibroScreen({libro}:{libro:"ventas"|"compras"}){
 const [periodo,setPeriodo]=useState(current); const [items,setItems]=useState<Item[]>([]); const [message,setMessage]=useState("");
 async function load(){const data=await apiSend<{items:Item[]}>(`/api/impuestos/libro/${libro}?periodo=${periodo}`,"GET");setItems(data.items);}
 useEffect(()=>{void apiSend<{items:Item[]}>(`/api/impuestos/libro/${libro}?periodo=${periodo}`,"GET").then(data=>setItems(data.items));},[libro,periodo]);
 return <main className="space-y-4 p-4 sm:p-6"><header><h1 className="text-xl font-semibold">Libro IVA {libro==="ventas"?"Ventas":"Compras"}</h1><p className="text-sm text-muted-foreground">Snapshots fiscales independientes de los comprobantes de Talón.</p></header>
 <div className="flex flex-wrap gap-2"><input aria-label="Período" className="rounded border px-3 py-2" value={periodo} onChange={e=>setPeriodo(e.target.value.replace(/\D/g,"").slice(0,6))}/><button className="rounded bg-primary px-3 py-2 text-primary-foreground" onClick={async()=>{setMessage("Procesando…");const r=await apiSend<{read:number;created:number;updated:number}>("/api/impuestos/traer-de-talon","POST",{periodo});setMessage(`${r.read} leídos; ${r.created} nuevos; ${r.updated} actualizados`);await load();}}>Traer de Talón</button></div>
 {message?<p role="status" className="text-sm">{message}</p>:null}<div className="overflow-x-auto rounded border"><table className="w-full text-sm"><thead><tr className="bg-muted"><th className="p-2 text-left">Fecha</th><th>Comprobante</th><th className="text-left">Contraparte</th><th className="text-right">Total</th><th>Estado</th></tr></thead><tbody>{items.map(i=><tr key={i.id} className="border-t"><td className="p-2">{i.fecha_cbte}</td><td className="text-center">{i.tipo_cbte} {i.punto_venta}-{i.numero_desde}</td><td>{i.denominacion}</td><td className="text-right">{formatMoney(Number(i.total_cents))}</td><td className="text-center">{i.estado}</td></tr>)}</tbody></table></div></main>;
}
