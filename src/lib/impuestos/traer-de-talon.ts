import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/tenant";

const RATE_CODE = new Map([[0,3],[250,9],[500,8],[1050,4],[2100,5],[2700,6]]);
function taxDestination(name: string, configured?: string | null) {
  if (configured) return configured;
  const text=name.toLowerCase();
  if (text.includes("percep") && text.includes("iva")) return "percep_iva";
  if (text.includes("iibb") || text.includes("ingresos brutos")) return "percep_iibb";
  if (text.includes("municip")) return "percep_muni";
  if (text.includes("intern")) return "internos";
  return "otros";
}

/** CUIT (80), DNI (96) o consumidor final sin documento (99 / 0), sólo dígitos. */
export function documentoArca(value: unknown): { docTipo: number; docNro: string } {
  const digits=String(value??"").replace(/\D/g,"");
  if(digits.length===11) return {docTipo:80,docNro:digits};
  if(digits.length>=7&&digits.length<=8) return {docTipo:96,docNro:digits};
  return {docTipo:99,docNro:"0"};
}

/** Crea/actualiza snapshots fiscales. Sólo ejecuta SELECT sobre tablas de Talón. */
export async function traerDeTalon(tx: Tx, companyId: string, userId: string, periodo: string) {
  if (!/^\d{6}$/.test(periodo)) throw new Error("Período inválido");
  const start=`${periodo.slice(0,4)}-${periodo.slice(4)}-01`;
  const docs=await tx.execute<Record<string, unknown>>(sql`
    select d.*,dt.sign,dt.afip_codes,dt.code as type_code,c.cuit as company_cuit
    from documents d join document_types dt on dt.id=d.document_type_id
    join companies c on c.id=d.company_id
    where d.company_id=${companyId} and d.kind in ('venta','compra') and dt.moves_vat
      and d.issued_on>=${start}::date and d.issued_on<(${start}::date+interval '1 month')
    order by d.issued_on,d.number`);
  let created=0,updated=0,voided=0,skipped=0;
  for(const d of docs){
    const id=String(d.id); const kind=String(d.kind); const isSale=kind==="venta";
    const afip=(d.afip_codes??{}) as Record<string,number>;
    const tipo=afip[String(d.letter??"")] ?? Number(Object.values(afip)[0]??0);
    if(!tipo) continue;
    const lines=await tx.execute<{iva_rate_bps:number;tax_treatment:string;neto:string;iva:string;exento:string;no_gravado:string}>(sql`
      select iva_rate_bps,tax_treatment,sum(net_cents)::text neto,sum(vat_cents)::text iva,
        sum(exempt_cents)::text exento,sum(untaxed_cents)::text no_gravado
      from document_lines where company_id=${companyId} and document_id=${id}::uuid
      group by iva_rate_bps,tax_treatment`);
    const taxes=await tx.execute<{name:string;amount:string;destino:string|null}>(sql`
      select t.name,t.amount_cents::text amount,m.destino from document_taxes t left join imp_mapeo_tributos m
        on m.company_id=t.company_id and lower(m.nombre_talon)=lower(t.name)
      where t.company_id=${companyId} and t.document_id=${id}::uuid`);
    const buckets={percep_iva:0,percep_iibb:0,percep_muni:0,internos:0,otros:0};
    for(const t of taxes) buckets[taxDestination(t.name,t.destino) as keyof typeof buckets]+=Number(t.amount);
    const exento=lines.reduce((n,l)=>n+Number(l.exento),0);
    const noGravado=lines.reduce((n,l)=>n+Number(l.no_gravado),0);
    const number=isSale?Number(d.number):Number(d.supplier_number??d.number);
    const point=isSale?Number(d.point_of_sale):Number(d.supplier_pos??d.point_of_sale);
    const party=documentoArca(d.party_cuit);
    const emitter=isSale?String(d.company_cuit??"").replace(/\D/g,""):party.docNro;
    // Si el comprobante ya entró por Mis Comprobantes no se duplica: manda el importado.
    const [dup]=await tx.execute<{id:string}>(sql`select id from imp_comprobantes where company_id=${companyId}
      and libro=${isSale?"ventas":"compras"} and (source_document_id is null or source_document_id<>${id}::uuid)
      and regexp_replace(doc_nro_emisor,'\\D','','g')=${emitter} and tipo_cbte=${tipo} and punto_venta=${point} and numero_desde=${number} limit 1`);
    if(dup){ skipped++; continue; }
    const [saved]=await tx.execute<{id:string;inserted:boolean}>(sql`
      insert into imp_comprobantes(company_id,libro,origen,source_document_id,fecha_cbte,periodo,tipo_cbte,punto_venta,
        numero_desde,numero_hasta,cae,doc_nro_emisor,doc_tipo,doc_nro,denominacion,moneda,tipo_cambio,
        neto_no_gravado_cents,exento_cents,percep_iva_cents,percep_iibb_cents,percep_municipales_cents,
        impuestos_internos_cents,otros_tributos_cents,total_cents,credito_fiscal_computable_cents,estado,created_by)
      values(${companyId},${isSale?"ventas":"compras"},'talon',${id}::uuid,${String(d.issued_on)}::date,${periodo},${tipo},${point},
        ${number},${number},${d.cae as string|null},${emitter},${party.docTipo},${party.docNro},${String(d.party_name)},'PES',1,
        ${noGravado},${exento},${buckets.percep_iva},${buckets.percep_iibb},${buckets.percep_muni},${buckets.internos},${buckets.otros},
        ${Number(d.total_cents)},${isSale?0:Number(d.vat_cents)},${d.voided_at?"anulado":"vigente"},${userId}::uuid)
      on conflict(company_id,empresa_cliente_id,source_document_id) where source_document_id is not null do update set
        fecha_cbte=excluded.fecha_cbte,tipo_cbte=excluded.tipo_cbte,punto_venta=excluded.punto_venta,
        numero_desde=excluded.numero_desde,numero_hasta=excluded.numero_hasta,cae=excluded.cae,doc_nro_emisor=excluded.doc_nro_emisor,
        doc_tipo=excluded.doc_tipo,doc_nro=excluded.doc_nro,denominacion=excluded.denominacion,neto_no_gravado_cents=excluded.neto_no_gravado_cents,
        exento_cents=excluded.exento_cents,percep_iva_cents=excluded.percep_iva_cents,percep_iibb_cents=excluded.percep_iibb_cents,
        percep_municipales_cents=excluded.percep_municipales_cents,impuestos_internos_cents=excluded.impuestos_internos_cents,
        otros_tributos_cents=excluded.otros_tributos_cents,total_cents=excluded.total_cents,
        credito_fiscal_computable_cents=excluded.credito_fiscal_computable_cents,estado=excluded.estado,updated_at=now()
      returning id,(xmax=0) inserted`);
    if(saved.inserted) created++; else updated++;
    if(d.voided_at) voided++;
    await tx.execute(sql`delete from imp_comprobante_alicuotas where comprobante_id=${saved.id}::uuid`);
    for(const line of lines.filter(l=>l.tax_treatment==="gravado")){
      const code=RATE_CODE.get(Number(line.iva_rate_bps)); if(!code) continue;
      await tx.execute(sql`insert into imp_comprobante_alicuotas(company_id,comprobante_id,alicuota_codigo,neto_cents,iva_cents)
        values(${companyId},${saved.id}::uuid,${code},${Number(line.neto)},${Number(line.iva)})`);
    }
  }
  return {read:docs.length,created,updated,voided,skipped};
}
