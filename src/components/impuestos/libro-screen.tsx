"use client";
import { useEffect, useState } from "react";
import { apiSend } from "@/lib/api/client";
import { LibroTabla, type LibroItem as Item } from "./libro-tabla";
const current=()=>new Date().toISOString().slice(0,7).replace("-","");
export function LibroScreen({libro}:{libro:"ventas"|"compras"}){
 const [periodo,setPeriodo]=useState(current); const [items,setItems]=useState<Item[]>([]); const [message,setMessage]=useState("");
 const [reload,setReload]=useState(0);
 // Patrón "ignore" de React: cada efecto descarta su respuesta si el período/libro
 // cambió antes de que llegara. Así una respuesta lenta de un período anterior no
 // pisa la del período elegido.
 useEffect(()=>{
  if(!/^\d{6}$/.test(periodo))return; // período incompleto: la tabla se vacía al renderizar
  let stale=false;
  apiSend<{items:Item[]}>(`/api/impuestos/libro/${libro}?periodo=${periodo}`,"GET")
   .then(data=>{if(!stale)setItems(data.items);})
   .catch(error=>{if(!stale){setItems([]);setMessage(error instanceof Error?error.message:"No pude cargar el libro");}});
  return()=>{stale=true;};
 },[libro,periodo,reload]);
 return <main className="space-y-4 p-4 sm:p-6"><header><h1 className="text-xl font-semibold">Libro IVA {libro==="ventas"?"Ventas":"Compras"}</h1><p className="text-sm text-muted-foreground">Snapshots fiscales independientes de los comprobantes de Talón.</p></header>
 <div className="flex flex-wrap gap-2"><input aria-label="Período" className="rounded border px-3 py-2" value={periodo} onChange={e=>setPeriodo(e.target.value.replace(/\D/g,"").slice(0,6))}/><button className="rounded bg-primary px-3 py-2 text-primary-foreground" onClick={async()=>{setMessage("Procesando…");try{const r=await apiSend<{read:number;created:number;updated:number;skipped?:number}>("/api/impuestos/traer-de-talon","POST",{periodo});setMessage(`${r.read} leídos; ${r.created} nuevos; ${r.updated} actualizados${r.skipped?`; ${r.skipped} ya estaban importados de Mis Comprobantes`:""}`);}catch(e){setMessage(e instanceof Error?e.message:"No pude traer de Talón");}setReload(n=>n+1);}}>Traer de Talón</button><a className="self-center text-sm underline" href={`/impuestos/libro/${libro}/${periodo}`} target="_blank" rel="noreferrer">Imprimir</a></div>
 {message?<p role="status" className="text-sm">{message}</p>:null}<LibroTabla items={/^\d{6}$/.test(periodo)?items:[]}/></main>;
}
