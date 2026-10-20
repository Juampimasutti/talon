import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/auditoria/auditoria-screen").then((mod) => mod.AuditoriaScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen />;
}
