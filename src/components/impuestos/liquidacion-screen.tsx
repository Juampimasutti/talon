"use client";
import { useEffect, useState } from "react";
import { apiSend } from "@/lib/api/client";
import { formatMoney, parseMoneyToCents } from "@/lib/format";
import { LiquidacionDetalle, type ItemLiquidacion } from "./liquidacion-detalle";

const current=()=>new Date().toISOString().slice(0,7).replace("-","");
type Campo="percepcionesCents"|"retencionesCents"|"pagosCuentaCents"|"seguridadSocialCents"|"saldoTecnicoAnteriorCents"|"saldoLibreAnteriorCents";
const CAMPOS:[Campo,string,string][]=[
 ["retencionesCents","Retenciones de IVA sufridas",""],
 ["percepcionesCents","Percepciones de IVA no cargadas en compras",""],
 ["pagosCuentaCents","Pagos a cuenta",""],
 ["seguridadSocialCents","Contribuciones seg. social (Dec. 814/01)",""],
 ["saldoTecnicoAnteriorCents","Saldo técnico a favor anterior","Vacío = se toma del período anterior confirmado"],
 ["saldoLibreAnteriorCents","Saldo libre disponibilidad anterior","Vacío = se toma del período anterior confirmado"],
];
type Resultado={estado?:string;items:ItemLiquidacion[];avisos?:string[]};

export function LiquidacionScreen(){
 const [periodo,setPeriodo]=useState(current); const [valores,setValores]=useState<Record<Campo,string>>({percepcionesCents:"",retencionesCents:"",pagosCuentaCents:"",seguridadSocialCents:"",saldoTecnicoAnteriorCents:"",saldoLibreAnteriorCents:""});
 const [result,setResult]=useState<Resultado|null>(null); const [error,setError]=useState(""); const [reason,setReason]=useState(""); const [info,setInfo]=useState("");
 useEffect(()=>{if(!/^\d{6}$/.test(periodo))return;let stale=false;
  apiSend<{liquidacion:{estado:string}|null;items:ItemLiquidacion[]}>(`/api/impuestos/liquidacion?periodo=${periodo}`,"GET").then(d=>{if(!stale)setResult(d.liquidacion?{estado:d.liquidacion.estado,items:d.items}:null);}).catch(()=>{if(!stale)setResult(null);});
  return()=>{stale=true;};},[periodo]);
 const invalid=CAMPOS.filter(([k])=>valores[k].trim()!==""&&parseMoneyToCents(valores[k])==null).map(([,l])=>l);
 const calculate=async(confirmar:boolean)=>{setError("");setInfo("");
  const body:Record<string,unknown>={periodo,confirmar};
  for(const [k] of CAMPOS){const v=valores[k].trim();if(v!=="")body[k]=parseMoneyToCents(v);}
  try{const r=await apiSend<{estado:string;items:ItemLiquidacion[];avisos:string[]}>("/api/impuestos/liquidacion","POST",body);setResult({estado:r.estado,items:r.items,avisos:r.avisos});}
  catch(e){setError(e instanceof Error?e.message:"No pude calcular la liquidación");}};
 const confirmada=result?.estado==="confirmada";
 return <main className="space-y-4 p-4 sm:p-6">
  <header><h1 className="text-xl font-semibold">Liquidación de IVA (borrador F.2002)</h1><p className="text-sm font-medium text-amber-700">Borrador – no constituye presentación ante ARCA.</p></header>
  <div className="flex flex-wrap items-end gap-2"><label className="text-sm">Período (AAAAMM)<input aria-label="Período" className="mt-1 block rounded border px-3 py-2" value={periodo} onChange={e=>setPeriodo(e.target.value.replace(/\D/g,"").slice(0,6))}/></label>
   {result?.estado?<span className={`rounded px-2 py-1 text-xs ${confirmada?"bg-green-100 text-green-800":"bg-muted"}`}>{confirmada?"Confirmada":"Borrador"}</span>:null}
   <a className="text-sm underline" href={`/impuestos/liquidacion/${periodo}`} target="_blank" rel="noreferrer">Imprimir</a></div>
  <fieldset className="grid max-w-2xl gap-3 sm:grid-cols-2" disabled={confirmada}><legend className="mb-2 text-sm font-semibold">Otros créditos y saldos (en pesos)</legend>
   {CAMPOS.map(([k,label,hint])=><label key={k} className="text-sm">{label}<input inputMode="decimal" className="mt-1 block w-full rounded border px-3 py-2 text-right" placeholder={hint?"automático":"0,00"} value={valores[k]} onChange={e=>setValores(v=>({...v,[k]:e.target.value}))}/>{hint?<span className="text-xs text-muted-foreground">{hint}</span>:null}</label>)}
  </fieldset>
  {invalid.length?<p className="text-sm text-red-700">Revisá el importe de: {invalid.join(", ")}.</p>:null}
  <div className="flex flex-wrap gap-2"><button className="rounded border px-3 py-2" disabled={confirmada||invalid.length>0} onClick={()=>void calculate(false)}>Calcular borrador</button><button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={confirmada||invalid.length>0} onClick={()=>void calculate(true)}>Confirmar y cerrar</button></div>
  {error?<p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>:null}
  {result?.avisos?.length?<ul className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{result.avisos.map(a=><li key={a}>{a}</li>)}</ul>:null}
  {result?.items.length?<LiquidacionDetalle items={result.items}/>:null}
  {result?.items.length?<p className="text-sm">{(()=>{const pagar=result.items.find(i=>i.concepto==="Saldo a pagar")?.importeCents??0;return pagar?`Saldo a pagar: ${formatMoney(pagar)}`:"Sin saldo a pagar en el período.";})()}</p>:null}
  <section className="max-w-xl space-y-2 border-t pt-4"><h2 className="font-semibold">Reabrir período</h2><input className="w-full rounded border px-3 py-2" placeholder="Motivo obligatorio" value={reason} onChange={e=>setReason(e.target.value)}/>
   <button className="rounded border px-3 py-2" disabled={reason.trim().length<5} onClick={async()=>{setError("");try{const r=await apiSend<{saldoPosteriorDesactualizado:boolean}>("/api/impuestos/reabrir","POST",{periodo,motivo:reason});setResult(x=>x?{...x,estado:"borrador"}:x);setInfo(r.saldoPosteriorDesactualizado?"Período reabierto. Ojo: hay liquidaciones posteriores que arrastraron este saldo.":"Período reabierto.");}catch(e){setError(e instanceof Error?e.message:"No pude reabrir");}}}>Reabrir con auditoría</button>
   {info?<p role="status" className="text-sm">{info}</p>:null}</section>
 </main>;
}
