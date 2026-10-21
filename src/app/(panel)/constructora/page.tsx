import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";
const Screen = dynamic(() => import("@/components/constructora/constructora-screen").then((module) => module.ConstructoraScreen), { loading: () => <ScreenFallback /> });
export default function Page() { return <Screen />; }
