import type { Metadata } from "next";
import { Archivo, Inter } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Letreiro em itálico bold condensado, no espírito das abas/rótulos do PropsBR
// (pedido explícito do usuário: "quero as letras nesse formato do propsbr") —
// contraste deliberado com a Inter do corpo/UI.
const grotesk = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  style: ["normal", "italic"],
  variable: "--font-grotesk",
});

export const metadata: Metadata = {
  title: "PropsEdge — Análise de Player Props",
  description: "Confiança, DvP, EV+ e comparador de odds para 10 esportes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${grotesk.variable}`}>
      <body className="min-h-screen font-sans">
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
