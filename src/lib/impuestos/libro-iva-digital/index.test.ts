import { describe, expect, it } from "vitest";
import { COMPRAS_ALICUOTAS, COMPRAS_CBTE, IMPORTACION_BIENES_ALICUOTA, VENTAS_ALICUOTAS, VENTAS_CBTE, formatFixed, makeTxt } from ".";

const receipt = { fecha:"2026-09-05",tipoCbte:1,puntoVenta:3,numeroDesde:10,numeroHasta:10,docTipo:80,docNro:"30710000030",denominacion:"PRUEBA",totalCents:1210000,tipoCambio:1,cantidadAlicuotas:1,creditoFiscalCents:210000 };
const rate = { tipoCbte:1,puntoVenta:3,numero:10,docNro:"30710000030",netoCents:1000000,codigo:5,ivaCents:210000 };
describe("Libro IVA Digital",()=>{
  it.each([[COMPRAS_CBTE,receipt,325],[COMPRAS_ALICUOTAS,rate,84],[VENTAS_CBTE,receipt,266],[VENTAS_ALICUOTAS,rate,62],[IMPORTACION_BIENES_ALICUOTA,rate,50]] as const)("valida cada largo",(spec,row,length)=>{
    expect(formatFixed(row as never,spec as never)).toHaveLength(length);
    expect(makeTxt([row as never],spec as never)).toHaveLength(length+2);
  });
  it("preserva el signo en la primera posición del importe",()=>{
    const line=formatFixed({...receipt,totalCents:-1210000},COMPRAS_CBTE);
    expect(line.slice(88,103)).toBe("-00000001210000");
  });
});
