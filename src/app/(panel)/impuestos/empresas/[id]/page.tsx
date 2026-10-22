import { EmpresaDetailScreen } from "@/components/impuestos/empresa-detail-screen";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <EmpresaDetailScreen id={id}/>}
