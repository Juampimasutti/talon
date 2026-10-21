import { CertificatePrint } from "@/components/constructora/certificate-print";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <CertificatePrint id={id}/>;}
