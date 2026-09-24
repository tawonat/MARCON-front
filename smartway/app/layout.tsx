import type { Metadata } from "next";
import "./globals.css";
import { DemoProvider } from "@/components/workspace/demo-store";

export const metadata: Metadata = {
  title: "MARCON | Portal e gestão de materiais",
  description: "Acesso ao portal Marcon e à gestão de materiais Smartway.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <DemoProvider>{children}</DemoProvider>
      </body>
    </html>
  );
}
