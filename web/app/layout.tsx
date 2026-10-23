import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Números e títulos (placar/KPIs): geométrica, com algarismos técnicos — contraste
// deliberado com a Inter do corpo/UI, no espírito de um placar esportivo.
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });

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
