import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/comprobantes/comprobantes-screen").then((mod) => mod.ComprobantesScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen />;
}
