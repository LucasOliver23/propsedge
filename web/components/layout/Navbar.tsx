"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Activity, LayoutGrid, Shield, Ticket, Trophy } from "lucide-react";

const LINKS = [
  { href: "/props", label: "Jogadores", icon: LayoutGrid },
  { href: "/times", label: "Times & Jogos", icon: Shield },
  { href: "/live", label: "Ao vivo", icon: Activity },
  { href: "/bets", label: "Bilheteira", icon: Ticket },
  { href: "/resultados", label: "Resultados", icon: Trophy },
];

export function Navbar() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4">
        <Link href="/props" className="text-lg font-black tracking-tight text-slate-100">
          Props<span className="text-sky-400">Edge</span>
        </Link>
        <nav className="flex gap-1">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition",
                path.startsWith(href) ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
