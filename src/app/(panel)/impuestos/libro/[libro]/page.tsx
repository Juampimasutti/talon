import { notFound } from "next/navigation"; import { LibroScreen } from "@/components/impuestos/libro-screen";
export default async function Page({params}:{params:Promise<{libro:string}>}){const {libro}=await params;if(libro!=="ventas"&&libro!=="compras")notFound();return <LibroScreen libro={libro}/>}
