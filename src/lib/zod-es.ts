import { z } from "zod";

const spanish: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return { message: "Falta este dato" };
      return { message: "El dato no tiene el formato esperado" };
    case z.ZodIssueCode.too_small:
      if (issue.type === "number") return { message: issue.inclusive && issue.minimum === 0 ? "Tiene que ser mayor a cero" : "El número es demasiado chico" };
      if (issue.type === "string") return { message: "Está muy corto" };
      if (issue.type === "array") return { message: "Falta al menos un ítem" };
      return { message: "El valor es demasiado chico" };
    case z.ZodIssueCode.too_big:
      if (issue.type === "number") return { message: "El número es demasiado grande" };
      if (issue.type === "string") return { message: "Está muy largo" };
      return { message: "El valor es demasiado grande" };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: "El mail no es válido" };
      if (issue.validation === "uuid") return { message: "El identificador no es válido" };
      if (issue.validation === "regex") return { message: "El formato no es válido" };
      return { message: "El texto no es válido" };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: "Elegí una opción de la lista" };
    case z.ZodIssueCode.invalid_date:
      return { message: "La fecha no es válida" };
    case z.ZodIssueCode.not_multiple_of:
      return { message: "El importe tiene que ser un número entero de centavos" };
    default:
      if (/[A-Za-z]/.test(ctx.defaultError) && !/[áéíóúñ]/i.test(ctx.defaultError)) return { message: "Revisá este dato" };
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(spanish);
