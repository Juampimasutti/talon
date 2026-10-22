import { LibroImpresion } from "@/components/impuestos/impresion-impuestos";
export default async function Page({params}:{params:Promise<{libro:string;periodo:string}>}){const {libro,periodo}=await params;return <LibroImpresion libro={libro} periodo={periodo}/>;}
