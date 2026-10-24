"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Activity, BarChart3, LayoutGrid, Shield, Ticket, Trophy } from "lucide-react";
import { AccountMenu } from "./AccountMenu";

const LINKS = [
  { href: "/props", label: "Jogadores", icon: LayoutGrid },
  { href: "/times", label: "Times & Jogos", icon: Shield },
  { href: "/tendencias", label: "Tendências", icon: BarChart3 },
  { href: "/live", label: "Ao vivo", icon: Activity },
  { href: "/bets", label: "Bilheteira", icon: Ticket },
  { href: "/resultados", label: "Resultados", icon: Trophy },
];

export function Navbar() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-7 px-4">
        <Link href="/props" className="font-display flex items-center gap-2 text-lg font-black italic tracking-tight text-slate-100">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-brand-400 shadow-[0_0_14px_2px_rgba(34,224,114,0.65)]" />
          Props<span className="text-brand-400">Edge</span>
        </Link>
        <nav className="flex h-14 gap-5 overflow-x-auto">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "font-display flex items-center gap-1.5 border-b-2 text-sm font-bold italic uppercase tracking-tight transition",
                  active
                    ? "border-brand-400 text-white shadow-[0_1px_0_0] shadow-brand-400/40"
                    : "border-transparent text-slate-400 hover:text-slate-200",
                )}
              >
                <Icon className={clsx("h-4 w-4", active && "text-brand-400 drop-shadow-[0_0_6px_rgba(34,224,114,0.7)]")} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <AccountMenu />
      </div>
    </header>
  );
}
