import { sql } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { ImportValidationError } from "@/lib/impuestos/mis-comprobantes";
import { withTenant } from "@/lib/db/tenant";
import type { Tx } from "@/lib/db/tenant";
import type { AuthContext } from "@/lib/auth/session";
import { HttpError, ok } from "@/lib/http";
import { cuitDigits, formatCuit, isValidCuit } from "@/lib/fiscal/cuit";
import { writeAudit } from "@/lib/domain/audit";
import { readBody } from "@/lib/validation";
import { calcularLiquidacion, itemsLiquidacion, periodoAnterior, saldosQueArrastra } from "@/lib/impuestos/calculos";
import { importarMisComprobantes } from "@/lib/impuestos/importar";
import { traerDeTalon } from "@/lib/impuestos/traer-de-talon";
import { toAnsi } from "@/lib/impuestos/libro-iva-digital";
import { buildLibroIvaDigital } from "@/lib/impuestos/libro-iva-digital/build";
import { makeZip } from "@/lib/impuestos/libro-iva-digital/zip";
import * as XLSX from "xlsx";

const period=z.string().regex(/^\d{6}$/,"Período inválido");
const importSchema=z.object({fileName:z.string().min(1).max(200),base64:z.string().min(1),periodo:period,crearEnTalon:z.boolean().default(false)});
const cents=z.number().int().min(0).max(1e15);
// Saldos anteriores: si vienen vacíos se toman de la liquidación confirmada del período anterior.
const confirmSchema=z.object({periodo:period,seguridadSocialCents:cents.default(0),saldoTecnicoAnteriorCents:cents.nullish(),saldoLibreAnteriorCents:cents.nullish(),retencionesCents:cents.default(0),percepcionesCents:cents.default(0),pagosCuentaCents:cents.default(0),confirmar:z.boolean().default(false)});
const PERIODO_CONFIRMADO="El período ya está confirmado. Para recalcularlo, primero reabrilo indicando el motivo.";
const fmtPeriodo=(p:string)=>`${p.slice(4)}/${p.slice(0,4)}`;
const reopenSchema=z.object({periodo:period,motivo:z.string().trim().min(5).max(1000)});
const empresaSchema=z.object({
  nombre:z.string().trim().min(1).max(120),
  razonSocial:z.string().trim().min(1).max(160),
  cuit:z.string().trim().refine(isValidCuit,"CUIT inválido"),
  condicionIva:z.string().trim().min(1).max(40),
  rubro:z.string().trim().max(120).nullish(),
});

type EmpresaFiscal={id:string;nombre:string;razonSocial:string;cuit:string;condicionIva:string;rubro:string|null;activa:boolean};

async function withImpuestos<T>(auth:AuthContext,url:URL,fn:(tx:Tx,empresa:EmpresaFiscal)=>Promise<T>,lock:"shared"|"exclusive"="shared"){
  return withTenant(auth.company.companyId,auth.user.id,async tx=>{
    const requested=url.searchParams.get("empresa");
    if(requested&&!z.string().uuid().safeParse(requested).success) throw new HttpError(400,"Empresa cliente inválida");
    const rows=await tx.execute<EmpresaFiscal>(requested?sql`
      select id,nombre,razon_social "razonSocial",cuit,condicion_iva "condicionIva",rubro,activa
      from imp_empresas where id=${requested}::uuid and activa`:sql`
      select id,nombre,razon_social "razonSocial",cuit,condicion_iva "condicionIva",rubro,activa
      from imp_empresas where activa order by nombre limit 2`);
    if(rows.length===0) throw new HttpError(404,"No existe esa empresa cliente activa");
    if(!requested&&rows.length!==1) throw new HttpError(400,"Elegí la empresa cliente sobre la que querés trabajar");
    const empresa=rows[0];
    await tx.execute(sql`select set_config('app.imp_empresa_id',${empresa.id},true)`);
    return fn(tx,empresa);
  },lock);
}

export async function impuestos(method:string,path:string[],req:Request){
  const [,resource,action,detail]=path; const url=new URL(req.url);
  if(resource==="empresas"){
    const auth=await requirePermission("impuestos",method==="GET"?"ver":method==="POST"?"crear":method==="PATCH"?"editar":"anular");
    if(method==="GET"&&!action) return withTenant(auth.company.companyId,auth.user.id,async tx=>ok({items:await tx.execute(sql`
      select id,nombre,razon_social "razonSocial",cuit,condicion_iva "condicionIva",rubro,activa
      from imp_empresas where activa order by nombre,cuit`)}));
    if(method==="POST"&&!action){
      const body=await readBody(req,empresaSchema);
      return withTenant(auth.company.companyId,auth.user.id,async tx=>{
        try{
          const [row]=await tx.execute<EmpresaFiscal>(sql`insert into imp_empresas(company_id,nombre,razon_social,cuit,condicion_iva,rubro,created_by)
            values(${auth.company.companyId},${body.nombre},${body.razonSocial},${cuitDigits(body.cuit)},${body.condicionIva},${body.rubro||null},${auth.user.id})
            returning id,nombre,razon_social "razonSocial",cuit,condicion_iva "condicionIva",rubro,activa`);
          await writeAudit(tx,{companyId:auth.company.companyId,userId:auth.user.id,action:"impuestos.empresa.crear",entity:"imp_empresa",entityId:row.id,summary:`Empresa impositiva creada: ${row.nombre}`,metadata:{cuit:formatCuit(row.cuit)}});
          return ok(row);
        }catch(error){if((error as {code?:string}).code==="23505") throw new HttpError(409,"Ya existe una empresa cliente con ese CUIT");throw error;}
      },"exclusive");
    }
    if(action&&z.string().uuid().safeParse(action).success&&method==="GET"){
      url.searchParams.set("empresa",action);
      return withImpuestos(auth,url,async(tx,empresa)=>{
        const [counts]=await tx.execute<{compras:number;ventas:number;periodos:number;liquidaciones:number}>(sql`select
          (select count(*)::int from imp_comprobantes where libro='compras') compras,
          (select count(*)::int from imp_comprobantes where libro='ventas') ventas,
          (select count(*)::int from imp_periodos) periodos,
          (select count(*)::int from imp_liquidaciones) liquidaciones`);
        return ok({empresa,counts,seccion:detail??null});
      });
    }
    if(action&&z.string().uuid().safeParse(action).success&&method==="PATCH"){
      const body=await readBody(req,empresaSchema);
      return withTenant(auth.company.companyId,auth.user.id,async tx=>{
        const [before]=await tx.execute<EmpresaFiscal>(sql`select id,nombre,razon_social "razonSocial",cuit,condicion_iva "condicionIva",rubro,activa from imp_empresas where id=${action}::uuid`);
        if(!before) throw new HttpError(404,"No existe esa empresa cliente");
        try{
          const [row]=await tx.execute<EmpresaFiscal>(sql`update imp_empresas set nombre=${body.nombre},razon_social=${body.razonSocial},cuit=${cuitDigits(body.cuit)},condicion_iva=${body.condicionIva},rubro=${body.rubro||null},updated_at=now() where id=${action}::uuid returning id,nombre,razon_social "razonSocial",cuit,condicion_iva "condicionIva",rubro,activa`);
          await writeAudit(tx,{companyId:auth.company.companyId,userId:auth.user.id,action:"impuestos.empresa.editar",entity:"imp_empresa",entityId:row.id,summary:`Empresa impositiva actualizada: ${row.nombre}`,metadata:{antes:before,despues:row}});
          return ok(row);
        }catch(error){if((error as {code?:string}).code==="23505") throw new HttpError(409,"Ya existe una empresa cliente con ese CUIT");throw error;}
      },"exclusive");
    }
    if(action&&z.string().uuid().safeParse(action).success&&method==="DELETE") return withTenant(auth.company.companyId,auth.user.id,async tx=>{
      const [row]=await tx.execute<EmpresaFiscal>(sql`update imp_empresas set activa=false,updated_at=now() where id=${action}::uuid and activa returning id,nombre,razon_social "razonSocial",cuit,condicion_iva "condicionIva",rubro,activa`);
      if(!row) throw new HttpError(404,"No existe esa empresa cliente activa");
      await writeAudit(tx,{companyId:auth.company.companyId,userId:auth.user.id,action:"impuestos.empresa.baja",entity:"imp_empresa",entityId:row.id,summary:`Empresa impositiva desactivada: ${row.nombre}`,metadata:{cuit:formatCuit(row.cuit)}});
      return ok({deleted:true});
    },"exclusive");
    throw new HttpError(404,"No existe esa ruta de empresas impositivas");
  }
  if(method==="GET"&&resource==="importar-rechazos"&&action){
    const auth=await requirePermission("impuestos","importar");
    return withImpuestos(auth,url,async tx=>{
      const rows=await tx.execute<{fila:number;motivo:string|null;raw:unknown}>(sql`select fila,motivo,raw from imp_import_rows where job_id=${action}::uuid and estado='rechazado' order by fila`);
      const quote=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
      const csv=`\uFEFFfila;motivo;valores\r\n${rows.map(r=>`${r.fila};${quote(r.motivo)};${quote(JSON.stringify(r.raw))}`).join("\r\n")}${rows.length?"\r\n":""}`;
      return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="rechazos-${action}.csv"`,"Cache-Control":"private, no-store"}});
    });
  }
  if(method==="GET"&&resource==="libro"){
    const auth=await requirePermission("impuestos","ver"); const libro=action;
    if(libro!=="ventas"&&libro!=="compras") throw new HttpError(400,"Libro inválido");
    const periodo=period.parse(url.searchParams.get("periodo"));
    return withImpuestos(auth,url,async tx=>ok({items:await tx.execute(sql`
      select c.*,t.signo,t.descripcion tipo_descripcion,t.letra,coalesce(jsonb_agg(jsonb_build_object('codigo',a.alicuota_codigo,'netoCents',a.neto_cents,'ivaCents',a.iva_cents)
        order by a.alicuota_codigo) filter(where a.id is not null),'[]') alicuotas
      from imp_comprobantes c join imp_tipos_comprobante t on t.codigo=c.tipo_cbte left join imp_comprobante_alicuotas a on a.comprobante_id=c.id
      where c.libro=${libro} and c.periodo=${periodo} group by c.id,t.signo,t.descripcion,t.letra order by c.fecha_cbte,c.punto_venta,c.numero_desde`)}));
  }
  if(method==="POST"&&resource==="traer-de-talon"){
    const auth=await requirePermission("impuestos","importar"); const body=await readBody(req,z.object({periodo:period}));
    return withImpuestos(auth,url,async tx=>ok(await traerDeTalon(tx,auth.company.companyId,auth.user.id,body.periodo)),"exclusive");
  }
  if(method==="POST"&&resource==="importar"){
    const auth=await requirePermission("impuestos","importar"); const body=await readBody(req,importSchema);
    const file=Buffer.from(body.base64,"base64"); if(file.length>15_000_000) throw new HttpError(413,"El archivo supera 15 MB");
    try {
      return await withImpuestos(auth,url,async (tx,empresa)=>ok(await importarMisComprobantes(tx,{
        companyId:auth.company.companyId,userId:auth.user.id,companyCuit:formatCuit(empresa.cuit),
        canCreateCustomer:can(auth.permissions,"clientes","crear"),canCreateSupplier:can(auth.permissions,"proveedores","crear"),
      },file,body.fileName,body.periodo,body.crearEnTalon)),"exclusive");
    } catch(error) {
      if(error instanceof ImportValidationError) throw new HttpError(error.status,error.message);
      throw error;
    }
  }
  if(method==="GET"&&resource==="exportar"){
    const auth=await requirePermission("impuestos","exportar"); const periodo=period.parse(url.searchParams.get("periodo"));
    return withImpuestos(auth,url,async tx=>{
      const receipts=await tx.execute<Record<string,unknown>>(sql`select * from imp_comprobantes where periodo=${periodo} and estado='vigente' order by libro,fecha_cbte,punto_venta,numero_desde,id`);
      const rates=await tx.execute<Record<string,unknown>>(sql`select a.* from imp_comprobante_alicuotas a join imp_comprobantes c on c.id=a.comprobante_id where c.periodo=${periodo} and c.estado='vigente' order by a.alicuota_codigo`);
      const built=buildLibroIvaDigital(receipts,rates);
      const zip=makeZip(Object.entries(built.files).map(([name,content])=>({name:`${name}_${periodo}.txt`,data:toAnsi(content)})));
      if(url.searchParams.get("formato")==="zip") return new Response(new Uint8Array(zip),{headers:{"Content-Type":"application/zip","Content-Disposition":`attachment; filename="libro-iva-digital-${periodo}.zip"`,"Cache-Control":"private, no-store"}});
      const spreadsheetRows=receipts.map(r=>({Libro:r.libro,Fecha:String(r.fecha_cbte).slice(0,10),Tipo:r.tipo_cbte,"Punto de venta":r.punto_venta,Número:r.numero_desde,Contraparte:r.denominacion,Total:Number(r.total_cents)/100,"Crédito fiscal":Number(r.credito_fiscal_computable_cents)/100}));
      const csv=`\uFEFFLibro;Fecha;Tipo;Punto de venta;Número;Contraparte;Total;Crédito fiscal\r\n${spreadsheetRows.map(r=>Object.values(r).map(v=>`"${(typeof v==="number"?v.toFixed(2).replace(".",","):String(v??"")).replaceAll('"','""')}"`).join(";")).join("\r\n")}${spreadsheetRows.length?"\r\n":""}`;
      const workbook=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(spreadsheetRows),"Libro IVA");
      return ok({periodo,files:built.files,avisos:built.avisos,zipBase64:zip.toString("base64"),csv,xlsxBase64:XLSX.write(workbook,{type:"base64",bookType:"xlsx"})});
    });
  }
  if(method==="GET"&&resource==="liquidacion"){
    const auth=await requirePermission("impuestos","ver"); const periodo=period.parse(url.searchParams.get("periodo"));
    return withImpuestos(auth,url,async tx=>{
      const [liq]=await tx.execute<Record<string,unknown>>(sql`select * from imp_liquidaciones where periodo=${periodo}`);
      if(!liq) return ok({liquidacion:null,items:[]});
      const items=await tx.execute(sql`select rubro,concepto,importe_cents::float8 "importeCents",origen from imp_liquidacion_items where liquidacion_id=${liq.id as string}::uuid order by posicion`);
      return ok({liquidacion:liq,items});
    });
  }
  if(method==="POST"&&resource==="liquidacion"){
    const auth=await requirePermission("impuestos","crear"); const body=await readBody(req,confirmSchema);
    return withImpuestos(auth,url,async tx=>{
      const rows=await tx.execute<{libro:"ventas"|"compras";signo:number;iva:string;credito:string;percep:string}>(sql`
        select c.libro,t.signo,coalesce(sum(a.iva_cents),0)::text iva,c.credito_fiscal_computable_cents::text credito,c.percep_iva_cents::text percep
        from imp_comprobantes c join imp_tipos_comprobante t on t.codigo=c.tipo_cbte left join imp_comprobante_alicuotas a on a.comprobante_id=c.id
        where c.periodo=${body.periodo} and c.estado='vigente' group by c.id,t.signo`);
      const [actual]=await tx.execute<{estado:string}>(sql`select estado from imp_liquidaciones where periodo=${body.periodo}`);
      if(actual?.estado==="confirmada") throw new HttpError(409,PERIODO_CONFIRMADO);
      const anterior=periodoAnterior(body.periodo); const avisos:string[]=[];
      const [prev]=await tx.execute<{totales:Record<string,unknown>}>(sql`select totales from imp_liquidaciones where periodo=${anterior} and estado='confirmada'`);
      const arrastre=prev?saldosQueArrastra(prev.totales):null;
      if(!prev) avisos.push(`No hay liquidación confirmada de ${fmtPeriodo(anterior)}: cargá a mano los saldos a favor del período anterior si corresponde.`);
      else if(arrastre?.formatoViejo) avisos.push(`La liquidación de ${fmtPeriodo(anterior)} es de una versión anterior: su saldo a favor se tomó como libre disponibilidad. Revisalo.`);
      const tecnicoManual=body.saldoTecnicoAnteriorCents!=null&&body.saldoTecnicoAnteriorCents!==(arrastre?.saldoTecnicoAnteriorCents??0);
      const libreManual=body.saldoLibreAnteriorCents!=null&&body.saldoLibreAnteriorCents!==(arrastre?.saldoLibreAnteriorCents??0);
      if(prev&&(tecnicoManual||libreManual)) avisos.push(`Los saldos anteriores cargados a mano difieren de la liquidación confirmada de ${fmtPeriodo(anterior)}.`);
      const ajustes={...body,saldoTecnicoAnteriorCents:body.saldoTecnicoAnteriorCents??arrastre?.saldoTecnicoAnteriorCents??0,saldoLibreAnteriorCents:body.saldoLibreAnteriorCents??arrastre?.saldoLibreAnteriorCents??0};
      const totals={...calcularLiquidacion(rows.map(r=>({libro:r.libro,signo:r.signo as 1|-1,ivaCents:Number(r.iva),creditoComputableCents:r.libro==="compras"?Number(r.credito):undefined,percepIvaCents:Number(r.percep)})),ajustes),periodoAnterior:anterior,saldosAnterioresAutomaticos:Boolean(prev)&&!tecnicoManual&&!libreManual};
      const items=itemsLiquidacion(totals,{saldoTecnicoAnterior:tecnicoManual||(!prev&&ajustes.saldoTecnicoAnteriorCents>0),saldoLibreAnterior:libreManual||(!prev&&ajustes.saldoLibreAnteriorCents>0),percepciones:body.percepcionesCents>0,retenciones:body.retencionesCents>0,pagosCuenta:body.pagosCuentaCents>0,seguridadSocial:body.seguridadSocialCents>0});
      const state=body.confirmar?"confirmada":"borrador"; const snapshot=body.confirmar?JSON.stringify({totals,inputs:ajustes,items}):null;
      let saved:Record<string,unknown>;
      try{
        [saved]=await tx.execute<Record<string,unknown>>(sql`insert into imp_liquidaciones(company_id,periodo,estado,totales,snapshot,confirmada_por,confirmada_at,created_by)
        values(${auth.company.companyId},${body.periodo},${state},${JSON.stringify(totals)}::jsonb,${snapshot}::jsonb,${body.confirmar?auth.user.id:null}::uuid,${body.confirmar?new Date().toISOString():null}::timestamptz,${auth.user.id}::uuid)
        on conflict(company_id,empresa_cliente_id,periodo) do update set estado=excluded.estado,totales=excluded.totales,snapshot=excluded.snapshot,confirmada_por=excluded.confirmada_por,confirmada_at=excluded.confirmada_at,updated_at=now() returning *`);
      }catch(error){ if((error as {code?:string}).code==="55000"||(error as {cause?:{code?:string}}).cause?.code==="55000") throw new HttpError(409,PERIODO_CONFIRMADO); throw error; }
      await tx.execute(sql`delete from imp_liquidacion_items where liquidacion_id=${saved.id as string}::uuid`);
      for(const [posicion,item] of items.entries()) await tx.execute(sql`insert into imp_liquidacion_items(company_id,liquidacion_id,rubro,concepto,importe_cents,origen,posicion)
        values(${auth.company.companyId},${saved.id as string}::uuid,${item.rubro},${item.concepto},${item.importeCents},${item.origen},${posicion})`);
      return ok({...saved,items,avisos});
    },"exclusive");
  }
  if(method==="POST"&&resource==="reabrir"){
    const auth=await requirePermission("impuestos","anular"); const body=await readBody(req,reopenSchema);
    return withImpuestos(auth,url,async tx=>{const [row]=await tx.execute<{warning:boolean}>(sql`select imp_reabrir_periodo(${body.periodo},${body.motivo}) warning`);return ok({reopened:true,saldoPosteriorDesactualizado:row.warning});},"exclusive");
  }
  throw new HttpError(404,"No existe esa ruta de impuestos");
}
