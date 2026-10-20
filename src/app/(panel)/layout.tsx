import { PanelShell } from "@/components/shell/panel-shell";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
