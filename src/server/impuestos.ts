import { sql } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/tenant";
import { HttpError, ok } from "@/lib/http";
import { readBody } from "@/lib/validation";
import { calcularLiquidacion } from "@/lib/impuestos/calculos";
import { importarMisComprobantes } from "@/lib/impuestos/importar";
import { traerDeTalon } from "@/lib/impuestos/traer-de-talon";
import { COMPRAS_ALICUOTAS, COMPRAS_CBTE, VENTAS_ALICUOTAS, VENTAS_CBTE, makeTxt } from "@/lib/impuestos/libro-iva-digital";
import * as XLSX from "xlsx";

const period=z.string().regex(/^\d{6}$/,"Período inválido");
const importSchema=z.object({fileName:z.string().min(1).max(200),base64:z.string().min(1),periodo:period,crearEnTalon:z.boolean().default(false)});
const confirmSchema=z.object({periodo:period,seguridadSocialCents:z.number().int().default(0),saldoTecnicoAnteriorCents:z.number().int().default(0),saldoLibreAnteriorCents:z.number().int().default(0),retencionesCents:z.number().int().default(0),pagosCuentaCents:z.number().int().default(0),confirmar:z.boolean().default(false)});
const reopenSchema=z.object({periodo:period,motivo:z.string().trim().min(5).max(1000)});

export async function impuestos(method:string,path:string[],req:Request){
  const [,resource,action]=path; const url=new URL(req.url);
  if(method==="GET"&&resource==="importar-rechazos"&&action){
    const auth=await requirePermission("impuestos","importar");
    return withTenant(auth.company.companyId,auth.user.id,async tx=>{
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
    return withTenant(auth.company.companyId,auth.user.id,async tx=>ok({items:await tx.execute(sql`
      select c.*,coalesce(jsonb_agg(jsonb_build_object('codigo',a.alicuota_codigo,'netoCents',a.neto_cents,'ivaCents',a.iva_cents)
        order by a.alicuota_codigo) filter(where a.id is not null),'[]') alicuotas
      from imp_comprobantes c left join imp_comprobante_alicuotas a on a.comprobante_id=c.id
      where c.libro=${libro} and c.periodo=${periodo} group by c.id order by c.fecha_cbte,c.punto_venta,c.numero_desde`)}));
  }
  if(method==="POST"&&resource==="traer-de-talon"){
    const auth=await requirePermission("impuestos","importar"); const body=await readBody(req,z.object({periodo:period}));
    return withTenant(auth.company.companyId,auth.user.id,async tx=>ok(await traerDeTalon(tx,auth.company.companyId,auth.user.id,body.periodo)),"exclusive");
  }
  if(method==="POST"&&resource==="importar"){
    const auth=await requirePermission("impuestos","importar"); const body=await readBody(req,importSchema);
    const file=Buffer.from(body.base64,"base64"); if(file.length>15_000_000) throw new HttpError(413,"El archivo supera 15 MB");
    return withTenant(auth.company.companyId,auth.user.id,async tx=>ok(await importarMisComprobantes(tx,{
      companyId:auth.company.companyId,userId:auth.user.id,companyCuit:auth.company.cuit,
      canCreateCustomer:can(auth.permissions,"clientes","crear"),canCreateSupplier:can(auth.permissions,"proveedores","crear"),
    },file,body.fileName,body.periodo,body.crearEnTalon)),"exclusive");
  }
  if(method==="GET"&&resource==="exportar"){
    const auth=await requirePermission("impuestos","exportar"); const periodo=period.parse(url.searchParams.get("periodo"));
    return withTenant(auth.company.companyId,auth.user.id,async tx=>{
      const receipts=await tx.execute<Record<string,unknown>>(sql`select * from imp_comprobantes where periodo=${periodo} and estado='vigente' order by libro,fecha_cbte,punto_venta,numero_desde`);
      const rates=await tx.execute<Record<string,unknown>>(sql`select a.*,c.libro,c.tipo_cbte,c.punto_venta,c.numero_desde,c.doc_nro from imp_comprobante_alicuotas a join imp_comprobantes c on c.id=a.comprobante_id where c.periodo=${periodo} and c.estado='vigente' order by c.libro,c.fecha_cbte,c.punto_venta,c.numero_desde,a.alicuota_codigo`);
      const mapReceipt=(r:Record<string,unknown>)=>({fecha:String(r.fecha_cbte),tipoCbte:Number(r.tipo_cbte),puntoVenta:Number(r.punto_venta),numeroDesde:String(r.numero_desde),numeroHasta:String(r.numero_hasta),docTipo:Number(r.doc_tipo),docNro:String(r.doc_nro),denominacion:String(r.denominacion),totalCents:Number(r.total_cents),moneda:String(r.moneda),tipoCambio:Number(r.tipo_cambio),cantidadAlicuotas:rates.filter(a=>a.comprobante_id===r.id).length,creditoFiscalCents:Number(r.credito_fiscal_computable_cents)});
      const mapRate=(r:Record<string,unknown>)=>({tipoCbte:Number(r.tipo_cbte),puntoVenta:Number(r.punto_venta),numero:String(r.numero_desde),docNro:String(r.doc_nro),netoCents:Number(r.neto_cents),codigo:Number(r.alicuota_codigo),ivaCents:Number(r.iva_cents)});
      const spreadsheetRows=receipts.map(r=>({Libro:r.libro,Fecha:r.fecha_cbte,Tipo:r.tipo_cbte,"Punto de venta":r.punto_venta,Número:r.numero_desde,Contraparte:r.denominacion,"Total centavos":r.total_cents,"Crédito fiscal centavos":r.credito_fiscal_computable_cents}));
      const csv=`\uFEFFLibro;Fecha;Tipo;Punto de venta;Número;Contraparte;Total centavos;Crédito fiscal centavos\r\n${spreadsheetRows.map(r=>Object.values(r).map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\r\n")}${spreadsheetRows.length?"\r\n":""}`;
      const workbook=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(spreadsheetRows),"Libro IVA");
      return ok({periodo,files:{
        LIBRO_IVA_DIGITAL_VENTAS_CBTE:makeTxt(receipts.filter(r=>r.libro==="ventas").map(mapReceipt),VENTAS_CBTE),
        LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS:makeTxt(rates.filter(r=>r.libro==="ventas").map(mapRate),VENTAS_ALICUOTAS),
        LIBRO_IVA_DIGITAL_COMPRAS_CBTE:makeTxt(receipts.filter(r=>r.libro==="compras").map(mapReceipt),COMPRAS_CBTE),
        LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS:makeTxt(rates.filter(r=>r.libro==="compras").map(mapRate),COMPRAS_ALICUOTAS),
      },csv,xlsxBase64:XLSX.write(workbook,{type:"base64",bookType:"xlsx"})});
    });
  }
  if(method==="POST"&&resource==="liquidacion"){
    const auth=await requirePermission("impuestos","crear"); const body=await readBody(req,confirmSchema);
    return withTenant(auth.company.companyId,auth.user.id,async tx=>{
      const rows=await tx.execute<{libro:"ventas"|"compras";signo:number;iva:string;credito:string;percep:string}>(sql`
        select c.libro,t.signo,coalesce(sum(a.iva_cents),0)::text iva,c.credito_fiscal_computable_cents::text credito,c.percep_iva_cents::text percep
        from imp_comprobantes c join imp_tipos_comprobante t on t.codigo=c.tipo_cbte left join imp_comprobante_alicuotas a on a.comprobante_id=c.id
        where c.periodo=${body.periodo} and c.estado='vigente' group by c.id,t.signo`);
      const totals=calcularLiquidacion(rows.map(r=>({libro:r.libro,signo:r.signo as 1|-1,ivaCents:Number(r.iva),creditoComputableCents:r.libro==="compras"?Number(r.credito):undefined,percepIvaCents:Number(r.percep)})),body);
      const state=body.confirmar?"confirmada":"borrador"; const snapshot=body.confirmar?JSON.stringify({totals,inputs:body}):null;
      const [saved]=await tx.execute(sql`insert into imp_liquidaciones(company_id,periodo,estado,totales,snapshot,confirmada_por,confirmada_at,created_by)
        values(${auth.company.companyId},${body.periodo},${state},${JSON.stringify(totals)}::jsonb,${snapshot}::jsonb,${body.confirmar?auth.user.id:null}::uuid,${body.confirmar?new Date().toISOString():null}::timestamptz,${auth.user.id}::uuid)
        on conflict(company_id,periodo) do update set estado=excluded.estado,totales=excluded.totales,snapshot=excluded.snapshot,confirmada_por=excluded.confirmada_por,confirmada_at=excluded.confirmada_at,updated_at=now() returning *`);
      return ok(saved);
    },"exclusive");
  }
  if(method==="POST"&&resource==="reabrir"){
    const auth=await requirePermission("impuestos","anular"); const body=await readBody(req,reopenSchema);
    return withTenant(auth.company.companyId,auth.user.id,async tx=>{const [row]=await tx.execute<{warning:boolean}>(sql`select imp_reabrir_periodo(${body.periodo},${body.motivo}) warning`);return ok({reopened:true,saldoPosteriorDesactualizado:row.warning});},"exclusive");
  }
  throw new HttpError(404,"No existe esa ruta de impuestos");
}
