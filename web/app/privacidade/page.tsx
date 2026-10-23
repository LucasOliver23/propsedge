import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — PropsEdge",
  description: "Como o PropsEdge coleta, usa e protege os seus dados.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 text-slate-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Política de Privacidade</h1>
        <p className="mt-1 text-xs text-slate-500">Última atualização: outubro de 2026</p>
      </div>

      <Section title="1. Quem somos">
        O PropsEdge (propsedge-pi.vercel.app) é uma ferramenta de análise estatística de apostas esportivas
        (player props e mercados de times). Esta política explica quais dados coletamos de quem usa o site e
        como esses dados são tratados.
      </Section>

      <Section title="2. Dados que coletamos">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>Conta:</b> ao entrar com Google ou por link mágico de e-mail, recebemos seu endereço de e-mail e,
            quando o Google fornece, seu nome e foto de perfil.
          </li>
          <li>
            <b>Uso do site:</b> as props que você fixa (track), seu bankroll virtual e o histórico dessas
            escolhas, para exibir seu desempenho dentro do PropsEdge.
          </li>
          <li>
            <b>Dados técnicos:</b> informações básicas de acesso (como data e hora de uso) para manter o serviço
            funcionando e identificar problemas.
          </li>
        </ul>
      </Section>

      <Section title="3. O que NÃO fazemos">
        O PropsEdge não processa pagamentos, não movimenta dinheiro real e não é uma casa de apostas. O
        "bankroll" mostrado no site é uma simulação para acompanhar o desempenho das análises — qualquer aposta
        real acontece fora do PropsEdge, diretamente na casa de apostas escolhida por você.
      </Section>

      <Section title="4. Como usamos seus dados">
        Usamos seus dados para: autenticar seu acesso, salvar suas props fixadas e seu bankroll virtual, e
        melhorar o produto. Não vendemos seus dados pessoais a terceiros.
      </Section>

      <Section title="5. Compartilhamento">
        Seus dados ficam armazenados no Supabase (nosso provedor de banco de dados e autenticação). Não
        compartilhamos seus dados pessoais com terceiros para fins de marketing.
      </Section>

      <Section title="6. Seus direitos">
        Você pode pedir a exclusão da sua conta e dos seus dados a qualquer momento, pelo e-mail de contato
        abaixo.
      </Section>

      <Section title="7. Contato">
        Dúvidas sobre esta política: <a className="text-brand-300 underline" href="mailto:clinemack5@gmail.com">clinemack5@gmail.com</a>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}
