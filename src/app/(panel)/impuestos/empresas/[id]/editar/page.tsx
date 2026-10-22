import { EmpresaFormScreen } from "@/components/impuestos/empresa-form-screen";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <EmpresaFormScreen id={id}/>}
