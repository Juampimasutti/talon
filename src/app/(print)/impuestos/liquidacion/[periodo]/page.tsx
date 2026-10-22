import { LiquidacionImpresion } from "@/components/impuestos/impresion-impuestos";
export default async function Page({params}:{params:Promise<{periodo:string}>}){const {periodo}=await params;return <LiquidacionImpresion periodo={periodo}/>;}
