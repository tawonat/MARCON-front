import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Marcon | Portal do colaborador", description: "Portal Marcon Smartway. Acesso por credenciais e RFID simulado." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
