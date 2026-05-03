import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "GLC Atende", description: "Sistema de Atendimento GLC Internet" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
