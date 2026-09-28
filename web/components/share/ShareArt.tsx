/* Artes para Instagram (1080 px de largura). Estilos inline + Tailwind: tudo vira PNG via html-to-image. */
import { proxied } from "@/lib/shareImage";
import { leagueName } from "@/lib/leagues";
import type { SeriesPoint, Side, TeamMarketRow } from "@/lib/types";
import type { ShareFormat } from "./ShareButton";

const GREEN = "#22c55e";
const RED = "#ef4444";

function Brand({ size = 44 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <svg width={size} height={size} viewBox="0 0 24 24">
        <rect x="2" y="14" width="5" height="8" rx="1.5" fill={GREEN} />
        <rect x="9.5" y="9" width="5" height="13" rx="1.5" fill={GREEN} />
        <rect x="17" y="3" width="5" height="19" rx="1.5" fill={GREEN} />
      </svg>
      <span style={{ fontSize: size * 0.95, fontWeight: 900, color: "#fff", letterSpacing: -1 }}>
        Props<span style={{ color: "#38bdf8" }}>Edge</span>
      </span>
    </div>
  );
}

function Disclaimer() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, borderTop: "1px solid #243044", paddingTop: 28 }}>
      <div style={{ width: 84, height: 84, borderRadius: 999, background: GREEN, color: "#000", fontSize: 34, fontWeight: 900,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+18</div>
      <p style={{ fontSize: 24, lineHeight: 1.35, color: "#94a3b8", margin: 0 }}>
        <b style={{ color: "#e2e8f0" }}>Jogue com responsabilidade.</b> Aposta não é investimento.
        Conteúdo informativo, sem garantia de resultado.
      </p>
    </div>
  );
}

function Logo({ src, size }: { src: string | null; size: number }) {
  const p = proxied(src);
  return p ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={p} alt="" width={size} height={size} style={{ objectFit: "contain" }} crossOrigin="anonymous" />
  ) : <div style={{ width: size, height: size, borderRadius: 999, background: "#1a2233" }} />;
}

const pct = (h: number, n: number) => (n ? `${Math.round((h / n) * 100)}%` : "—");

/** Arte de um mercado (time ou jogo) com a linha/lado/janela que o usuário escolheu */
export function MarketArt({ row, line, side, points, windowLabel, windows, projection, score, chance, grade, format }: {
  row: TeamMarketRow; line: number; side: Side; points: SeriesPoint[]; windowLabel: string;
  windows: { label: string; hits: number; n: number }[]; projection: number | null; score: number; chance: number;
  grade: string | null; format: ShareFormat;
}) {
  const isMatch = row.subject === "match";
  const title = isMatch ? `${row.home_name} x ${row.away_name}` : row.team_name ?? "";
  const pts = [...points].reverse();
  const max = Math.max(...pts.map((p) => p.v), line, 1) * 1.15;
  const hits = pts.filter((p) => (p.v > line) === (side === "over") && p.v !== line).length;
  const chartH = format === "stories" ? 620 : 430;
  const date = new Date(row.start_time);

  return (
    <div style={{ width: "100%", height: "100%", background: "radial-gradient(1200px 600px at 0% 0%, #0f2a1d 0%, #0b0f17 55%)",
      fontFamily: "var(--font-inter), system-ui, sans-serif", color: "#fff", padding: 64, boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: format === "stories" ? 44 : 30 }}>
      <Brand />

      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <Logo src={isMatch ? row.home_logo : row.team_logo} size={isMatch ? 120 : 150} />
        {isMatch && <Logo src={row.away_logo} size={120} />}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: isMatch ? 52 : 64, fontWeight: 900, margin: 0, lineHeight: 1.05 }}>{title}</p>
          <p style={{ fontSize: 28, color: "#94a3b8", margin: "10px 0 0" }}>
            {date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · {date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            {" · "}{leagueName(row.league_slug)}
            {!isMatch && ` · ${row.subject === "home" ? "vs" : "@"} ${row.subject === "home" ? row.away_name : row.home_name}`}
          </p>
        </div>
      </div>

      <div style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 18, background: "#111827",
        border: `2px solid ${side === "over" ? GREEN : RED}`, borderRadius: 22, padding: "18px 30px" }}>
        <span style={{ fontSize: 30, fontWeight: 900, color: side === "over" ? GREEN : RED }}>{side === "over" ? "MAIS DE" : "MENOS DE"}</span>
        <span style={{ fontSize: 46, fontWeight: 900 }}>{line}</span>
        <span style={{ fontSize: 34, fontWeight: 600, color: "#e2e8f0" }}>{row.stat_label}{isMatch ? " (jogo)" : ""}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {[
          ["PROJEÇÃO", projection != null ? projection.toFixed(1) : "—", projection != null ? `${projection >= line ? "+" : ""}${(projection - line).toFixed(1)}` : ""],
          ["BATEU", pct(hits, pts.length), `${hits} de ${pts.length} · ${windowLabel}`],
          ["SCORE", String(score), `chance ${Math.round(chance * 100)}%`],
          ["MATCHUP", grade ?? "—", grade ? (grade <= "B" ? "favorável" : grade === "C" ? "neutro" : "difícil") : ""],
        ].map(([k, v, s]) => (
          <div key={k} style={{ background: "#111827", border: "1px solid #243044", borderRadius: 22, padding: "22px 10px", textAlign: "center" }}>
            <p style={{ fontSize: 22, color: "#94a3b8", margin: 0, letterSpacing: 1 }}>{k}</p>
            <p style={{ fontSize: 56, fontWeight: 900, margin: "6px 0", color: k === "MATCHUP" && grade && grade > "C" ? RED : GREEN }}>{v}</p>
            <p style={{ fontSize: 22, color: "#94a3b8", margin: 0 }}>{s}</p>
          </div>
        ))}
      </div>

      {/* gráfico */}
      <div style={{ position: "relative", height: chartH, boxSizing: "border-box", background: "#111827", border: "1px solid #243044", borderRadius: 24, padding: "30px 24px 90px" }}>
        <div style={{ position: "relative", height: "100%" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(line / max) * 100}%`, borderTop: "3px solid rgba(255,255,255,.75)", zIndex: 2 }}>
          <span style={{ position: "absolute", top: -22, left: 0, background: "#0b0f17", border: "2px solid #fff", borderRadius: 8, padding: "2px 10px", fontSize: 24, fontWeight: 800 }}>{line}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: "100%", paddingLeft: 70 }}>
          {pts.map((p, i) => {
            const ok = p.v === line ? null : (p.v > line) === (side === "over");
            return (
              <div key={i} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", position: "relative" }}>
                <div style={{ boxSizing: "border-box", height: `${Math.max((p.v / max) * 100, 8)}%`, background: ok === null ? "#64748b" : ok ? GREEN : RED,
                  borderRadius: "12px 12px 0 0", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 10 }}>
                  <span style={{ fontSize: 28, fontWeight: 900 }}>{p.v}</span>
                </div>
                <div style={{ position: "absolute", bottom: -78, left: 0, right: 0, textAlign: "center" }}>
                  <p style={{ fontSize: 18, color: "#cbd5e1", margin: 0 }}>{new Date(p.d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</p>
                  <p style={{ fontSize: 16, color: "#64748b", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.o}</p>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${windows.length}, 1fr)`, background: "#111827", border: "1px solid #243044", borderRadius: 22 }}>
        {windows.map((w) => {
          const r = w.n ? w.hits / w.n : null;
          return (
            <div key={w.label} style={{ textAlign: "center", padding: "18px 0" }}>
              <p style={{ fontSize: 22, color: "#94a3b8", margin: 0 }}>{w.label}</p>
              <p style={{ fontSize: 36, fontWeight: 900, margin: "4px 0 0", color: r == null ? "#475569" : r >= 0.6 ? GREEN : r >= 0.45 ? "#fbbf24" : RED }}>
                {r == null ? "—" : `${Math.round(r * 100)}%`}
              </p>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "auto" }}><Disclaimer /></div>
    </div>
  );
}

/** Arte do resumo da rodada ("Mercados que se destacaram") */
export function RecapArt({ dayLabel, markets, total, greens, format }: {
  dayLabel: string; markets: { label: string; entries: number; greens: number }[]; total: number; greens: number; format: ShareFormat;
}) {
  const list = markets.slice(0, format === "stories" ? 12 : 9);
  const hr = total ? greens / total : 0;
  return (
    <div style={{ width: "100%", height: "100%", background: "radial-gradient(1200px 700px at 100% 0%, #0f2a1d 0%, #0b0f17 60%)",
      fontFamily: "var(--font-inter), system-ui, sans-serif", color: "#fff", padding: 64, boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: 34 }}>
      <Brand />
      <div>
        <p style={{ fontSize: 28, color: GREEN, fontWeight: 800, letterSpacing: 2, margin: 0, textTransform: "uppercase" }}>{dayLabel}</p>
        <p style={{ fontSize: 96, fontWeight: 900, lineHeight: 0.95, margin: "10px 0 0" }}>
          MERCADOS QUE <span style={{ color: GREEN }}>SE DESTACARAM!</span>
        </p>
      </div>

      <div style={{ background: "#111827", border: "1px solid #243044", borderRadius: 24, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 190px 230px", padding: "16px 28px", color: "#94a3b8", fontSize: 22, fontWeight: 700, borderBottom: "1px solid #243044" }}>
          <span>MERCADO</span><span style={{ textAlign: "center" }}>ENTRADAS</span><span>HIT RATE</span>
        </div>
        {list.map((m) => {
          const r = m.greens / m.entries;
          const color = r >= 0.7 ? GREEN : r >= 0.55 ? "#fbbf24" : RED;
          return (
            <div key={m.label} style={{ display: "grid", gridTemplateColumns: "1fr 190px 230px", alignItems: "center", padding: "18px 28px", borderBottom: "1px solid #1c2638" }}>
              <span style={{ fontSize: 30, fontWeight: 800 }}>{m.label}</span>
              <span style={{ textAlign: "center", fontSize: 28 }}><b style={{ color: GREEN }}>{m.greens}</b> de {m.entries}</span>
              <span>
                <span style={{ fontSize: 36, fontWeight: 900, color }}>{Math.round(r * 100)}%</span>
                <span style={{ display: "block", height: 10, borderRadius: 99, background: "rgba(255,255,255,.1)", marginTop: 6 }}>
                  <span style={{ display: "block", height: "100%", width: `${r * 100}%`, borderRadius: 99, background: color }} />
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", background: "#111827", border: "1px solid #243044", borderRadius: 24, padding: "24px 0", textAlign: "center" }}>
        {[["ENTRADAS", String(total), "#fff"], ["GREEN", String(greens), GREEN], ["RED", String(total - greens), RED],
          ["HIT RATE", `${Math.round(hr * 100)}%`, hr >= 0.6 ? GREEN : "#fbbf24"]].map(([k, v, c]) => (
          <div key={k}>
            <p style={{ fontSize: 22, color: "#94a3b8", margin: 0 }}>{k}</p>
            <p style={{ fontSize: 60, fontWeight: 900, margin: 0, color: c }}>{v}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "auto" }}><Disclaimer /></div>
    </div>
  );
}
