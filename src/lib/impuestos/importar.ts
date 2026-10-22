import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/tenant";
import { ImportValidationError, parseMisComprobantesXlsx } from "./mis-comprobantes";

export type ImportContext = { companyId:string; userId:string; companyCuit:string; canCreateCustomer:boolean; canCreateSupplier:boolean };

export async function importarMisComprobantes(tx:Tx,context:ImportContext,file:Buffer,fileName:string,periodo:string,crearEnTalon=false){
  const prior=await tx.execute<{identity:string}>(sql`select doc_nro_emisor||'|'||tipo_cbte||'|'||punto_venta||'|'||numero_desde identity from imp_comprobantes`);
  const parsed=parseMisComprobantesXlsx(file,{companyCuit:context.companyCuit,existingIdentities:prior.map(r=>r.identity)});
  if(crearEnTalon && parsed.tipo==="emitidos" && !context.canCreateCustomer) throw new ImportValidationError("Para crear las contrapartes en Talón falta el permiso clientes.crear",403);
  if(crearEnTalon && parsed.tipo==="recibidos" && !context.canCreateSupplier) throw new ImportValidationError("Para crear las contrapartes en Talón falta el permiso proveedores.crear",403);
  const hash=createHash("sha256").update(file).digest("hex");
  const [job]=await tx.execute<{id:string}>(sql`insert into imp_import_jobs(company_id,tipo,archivo_nombre,archivo_hash,estado,resumen,created_by)
    values(${context.companyId},${parsed.tipo==="emitidos"?"mc_emitidos":"mc_recibidos"},${fileName},${hash},'procesando',${JSON.stringify(parsed.resumen)}::jsonb,${context.userId}::uuid) returning id`);
  for(const row of parsed.rows){
    let comprobanteId:string|null=null;
    if(row.estado==="ok"){
      let counterpartId:string|null=null;
      if(row.docTipo!==99 && row.docNro!=="0"){
        const [counterpart]=await tx.execute<{id:string}>(sql`insert into imp_contrapartes(company_id,doc_tipo,doc_nro,denominacion,condicion_a_revisar)
          values(${context.companyId},${row.docTipo},${row.docNro},${row.denominacion},true)
          on conflict(company_id,doc_tipo,doc_nro) do update set denominacion=excluded.denominacion returning id`);
        counterpartId=counterpart.id;
        if(crearEnTalon){
          if(parsed.tipo==="emitidos"){
            const existing=await tx.execute<{id:string}>(sql`select id from customers where company_id=${context.companyId} and cuit=${row.docNro} limit 1`);
            const party=existing[0]??(await tx.execute<{id:string}>(sql`insert into customers(company_id,code,name,doc_type,cuit,tax_condition)
              values(${context.companyId},${`IMP-${row.docNro}`},${row.denominacion},${row.docTipo===80?"CUIT":"DNI"},${row.docNro},'cf') returning id`))[0];
            await tx.execute(sql`update imp_contrapartes set customer_id=${party.id}::uuid where id=${counterpart.id}::uuid`);
          }else{
            const existing=await tx.execute<{id:string}>(sql`select id from suppliers where company_id=${context.companyId} and cuit=${row.docNro} limit 1`);
            const party=existing[0]??(await tx.execute<{id:string}>(sql`insert into suppliers(company_id,code,name,doc_type,cuit,tax_condition)
              values(${context.companyId},${`IMP-${row.docNro}`},${row.denominacion},${row.docTipo===80?"CUIT":"DNI"},${row.docNro},'cf') returning id`))[0];
            await tx.execute(sql`update imp_contrapartes set supplier_id=${party.id}::uuid where id=${counterpart.id}::uuid`);
          }
        }
      }
      const [receipt]=await tx.execute<{id:string}>(sql`insert into imp_comprobantes(company_id,libro,origen,fecha_cbte,periodo,tipo_cbte,punto_venta,numero_desde,numero_hasta,cae,
        doc_nro_emisor,doc_tipo,doc_nro,denominacion,contraparte_id,moneda,tipo_cambio,neto_no_gravado_cents,exento_cents,otros_tributos_cents,total_cents,
        credito_fiscal_computable_cents,requiere_revision,avisos,created_by)
        values(${context.companyId},${row.libro},'mis_comprobantes',${row.fecha}::date,${periodo||row.periodo},${row.tipoCbte},${row.puntoVenta},${row.numeroDesde},${row.numeroHasta},${row.cae},
        ${row.libro==="ventas"?context.companyCuit:row.docNro},${row.docTipo},${row.docNro},${row.denominacion},${counterpartId}::uuid,${row.moneda},${row.tipoCambio},
        ${row.netoNoGravadoCents},${row.exentoCents},${row.otrosTributosCents},${row.totalCents},${row.creditoFiscalComputableCents},
        ${row.avisos.length>0},${JSON.stringify(row.avisos)}::jsonb,${context.userId}::uuid) returning id`);
      comprobanteId=receipt.id;
      for(const rate of row.alicuotas) await tx.execute(sql`insert into imp_comprobante_alicuotas(company_id,comprobante_id,alicuota_codigo,neto_cents,iva_cents)
        values(${context.companyId},${receipt.id}::uuid,${rate.codigo},${rate.netoCents},${rate.ivaCents})`);
    }
    await tx.execute(sql`insert into imp_import_rows(company_id,job_id,fila,raw,estado,motivo,comprobante_id)
      values(${context.companyId},${job.id}::uuid,${row.fila},${JSON.stringify(row.raw)}::jsonb,${row.estado},${row.motivo??null},${comprobanteId}::uuid)`);
  }
  await tx.execute(sql`update imp_import_jobs set estado='confirmado',confirmed_at=now() where id=${job.id}::uuid`);
  return {jobId:job.id,...parsed.resumen};
}
