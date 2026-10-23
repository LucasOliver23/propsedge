import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Serviço — PropsEdge",
  description: "Regras de uso do PropsEdge.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 text-slate-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Termos de Serviço</h1>
        <p className="mt-1 text-xs text-slate-500">Última atualização: outubro de 2026</p>
      </div>

      <Section title="1. O que é o PropsEdge">
        O PropsEdge é uma ferramenta de análise estatística de player props e mercados esportivos. Ele calcula
        taxas de acerto históricas, confiança e valor esperado (EV) a partir de dados públicos de estatísticas e
        odds, com fins informativos.
      </Section>

      <Section title="2. Não somos uma casa de apostas">
        O PropsEdge não aceita apostas, não processa pagamentos e não movimenta dinheiro real. O site apenas
        organiza informação e, quando você escolhe, te leva até a casa de apostas de sua preferência para
        concluir a aposta por conta própria. Qualquer aposta real é feita inteiramente fora do PropsEdge, sujeita
        aos termos da casa escolhida.
      </Section>

      <Section title="3. Sem garantia de resultado">
        As análises, scores de confiança e sinais de EV são estimativas estatísticas baseadas em dados
        históricos e não garantem o resultado de nenhuma aposta. Apostas esportivas envolvem risco financeiro
        real e você é o único responsável pelas decisões que tomar.
      </Section>

      <Section title="4. Idade mínima">
        O uso do PropsEdge é destinado a maiores de 18 anos. Ao usar o site, você declara ter essa idade.
      </Section>

      <Section title="5. Sua conta">
        Você é responsável por manter o acesso à sua conta seguro. Podemos suspender contas usadas de forma
        abusiva ou que violem estes termos.
      </Section>

      <Section title="6. Mudanças no serviço">
        O PropsEdge pode mudar, pausar ou encerrar funcionalidades a qualquer momento, já que é um projeto em
        desenvolvimento contínuo.
      </Section>

      <Section title="7. Contato">
        Dúvidas sobre estes termos: <a className="text-sky-300 underline" href="mailto:clinemack5@gmail.com">clinemack5@gmail.com</a>
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
