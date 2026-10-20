import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/caja/caja-screen").then((mod) => mod.CajaScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen />;
}
