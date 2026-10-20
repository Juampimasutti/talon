/**
 * Puerto de facturación electrónica.
 * Hoy no habla con ARCA: deja el contrato listo para enchufar WSFE
 * (certificado, clave y punto de venta) sin tocar el resto del sistema.
 */
export type FiscalAuthorizationRequest = {
  companyCuit: string;
  pointOfSale: number;
  afipCode: number;
  letter: "A" | "B" | "C";
  number: number;
  issuedOn: string;
  receiverCuit: string | null;
  receiverTaxCondition: string;
  netTaxedCents: number;
  vatCents: number;
  totalCents: number;
};

export type FiscalAuthorization = {
  cae: string;
  caeDue: string;
};

export interface ElectronicInvoicingPort {
  readonly name: string;
  authorize(input: FiscalAuthorizationRequest): Promise<FiscalAuthorization>;
}

export class ArcaNotConfigured implements ElectronicInvoicingPort {
  readonly name = "arca";

  async authorize(): Promise<FiscalAuthorization> {
    throw new Error(
      "ARCA no está configurado. Cuando tengas certificado y punto de venta electrónico, implementá ElectronicInvoicingPort.",
    );
  }
}

export function getInvoicingPort(): ElectronicInvoicingPort {
  if (process.env.ARCA_MODE === "live") {
    return new ArcaNotConfigured();
  }
  return new ArcaNotConfigured();
}

/** URL del QR de AFIP cuando el comprobante tiene CAE. */
export function afipQrUrl(input: {
  cuit: string;
  pointOfSale: number;
  afipCode: number | null;
  number: number;
  issuedOn: string;
  totalCents: number;
  receiverCuit: string | null;
  cae: string | null;
}): string | null {
  if (!input.cae || !input.afipCode) return null;
  const payload = {
    ver: 1,
    fecha: input.issuedOn,
    cuit: Number(input.cuit.replace(/\D/g, "")),
    ptoVta: input.pointOfSale,
    tipoCmp: input.afipCode,
    nroCmp: input.number,
    importe: input.totalCents / 100,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: input.receiverCuit ? 80 : 99,
    nroDocRec: Number((input.receiverCuit ?? "0").replace(/\D/g, "")),
    tipoCodAut: "E",
    codAut: Number(input.cae),
  };
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json).toString("base64");
  return `https://www.afip.gob.ar/fe/qr/?p=${encoded}`;
}

export function afipCodeFor(codes: Record<string, number> | null | undefined, letter: string | null): number | null {
  if (!letter || !codes) return null;
  const code = codes[letter];
  return typeof code === "number" ? code : null;
}
