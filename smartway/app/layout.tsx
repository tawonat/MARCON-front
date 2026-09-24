import type { Metadata } from "next";
import "./globals.css";
import { DemoProvider } from "@/components/workspace/demo-store";

export const metadata: Metadata = {
  title: "MARCON | Gestão de materiais",
  description: "Painel de requisições e gestão de materiais MARCON.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>
        <DemoProvider>{children}</DemoProvider>
      </body>
    </html>
  );
}
