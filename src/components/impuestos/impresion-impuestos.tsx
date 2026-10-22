"use client";
import { useEffect, useState } from "react";
import { apiSend } from "@/lib/api/client";
import { LibroTabla, type LibroItem } from "./libro-tabla";
import { LiquidacionDetalle, type ItemLiquidacion } from "./liquidacion-detalle";

const per=(p:string)=>`${p.slice(4)}/${p.slice(0,4)}`;
function useData<T>(url:string){const [d,setD]=useState<T|null>(null);const [e,setE]=useState("");
 useEffect(()=>{apiSend<T>(url,"GET").then(setD).catch(x=>setE(x instanceof Error?x.message:"No pude cargar los datos"));},[url]);return {d,e};}

export function LibroImpresion({libro,periodo}:{libro:string;periodo:string}){
 const {d,e}=useData<{items:LibroItem[]}>(`/api/impuestos/libro/${libro}?periodo=${periodo}`);
 return <main className="space-y-3 p-6 text-black"><h1 className="text-lg font-semibold">Libro IVA {libro==="ventas"?"Ventas":"Compras"} · {per(periodo)}</h1><p className="text-xs">Impreso de trabajo generado por Talón. No constituye presentación ante ARCA.</p>
  {e?<p>{e}</p>:d?<LibroTabla items={d.items}/>:<p>Cargando…</p>}</main>;
}
export function LiquidacionImpresion({periodo}:{periodo:string}){
 const {d,e}=useData<{liquidacion:{estado:string}|null;items:ItemLiquidacion[]}>(`/api/impuestos/liquidacion?periodo=${periodo}`);
 return <main className="space-y-3 p-6 text-black"><h1 className="text-lg font-semibold">Liquidación IVA · {per(periodo)}</h1><p className="text-xs font-semibold">Borrador – no constituye presentación ante ARCA.</p>
  {e?<p>{e}</p>:!d?<p>Cargando…</p>:d.liquidacion?<><p className="text-sm">Estado: {d.liquidacion.estado==="confirmada"?"Confirmada":"Borrador"}</p><LiquidacionDetalle items={d.items}/></>:<p>No hay liquidación calculada para este período.</p>}</main>;
}
