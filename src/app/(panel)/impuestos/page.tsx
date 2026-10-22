import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(
  () => import("@/components/impuestos/impuestos-screen").then((module) => module.ImpuestosScreen),
  { loading: () => <ScreenFallback label="Abriendo impuestos" /> },
);

export default function Page() {
  return <Screen />;
}
