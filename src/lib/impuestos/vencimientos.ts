export type Vencimiento = { obligacion:string;periodo:string;terminacionDesde:number;terminacionHasta:number;fecha:string;fuenteUrl:string };
export function proximoVencimiento(cuit:string,obligacion:string,periodo:string,rows:Vencimiento[]){
  const digits=cuit.replace(/\D/g,"");if(digits.length!==11)return null;const end=Number(digits.at(-1));
  return rows.find(r=>r.obligacion===obligacion&&r.periodo===periodo&&end>=r.terminacionDesde&&end<=r.terminacionHasta)??null;
}
