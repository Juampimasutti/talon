import { z } from "zod";

export const CONDICIONES_IVA = [
  { value: "ri", label: "Responsable inscripto", arca: 1 },
  { value: "monotributo", label: "Monotributo", arca: 6 },
  { value: "exento", label: "Exento", arca: 4 },
  { value: "cf", label: "Consumidor final", arca: 5 },
  { value: "no_alcanzado", label: "No alcanzado", arca: 15 },
] as const;
export const condicionIvaSchema = z.enum(["ri", "monotributo", "exento", "cf", "no_alcanzado"]);
export function puedeLiquidarF2002(condicion: string) { return condicion === "ri"; }
