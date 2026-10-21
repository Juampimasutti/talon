import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";
const Screen = dynamic(() => import("@/components/inmobiliaria/inmobiliaria-screen").then((module) => module.InmobiliariaScreen), { loading: () => <ScreenFallback /> });
export default function Page() { return <Screen />; }
