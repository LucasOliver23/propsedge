import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Números e títulos (placar/KPIs): grotesca bem encorpada, no espírito de um
// placar esportivo — contraste deliberado com a Inter do corpo/UI. Direção
// visual "Grotesk Impacto" escolhida pelo usuário entre as 3 opções mostradas.
const grotesk = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
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
