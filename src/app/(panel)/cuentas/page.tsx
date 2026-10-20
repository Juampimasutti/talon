import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/cuentas/cuentas-screen").then((mod) => mod.CuentasScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen />;
}
