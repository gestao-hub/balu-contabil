// Bloco 4A — o bloqueio dito na ENTRADA, não no envio.
//
// O gate mora na action e é lá que ele vale (defesa que não depende de UI).
// Mas descobrir a pendência só depois de preencher um cadastro inteiro é
// castigo: o usuário perde o trabalho para receber uma mensagem que o app
// já sabia dar antes do primeiro campo. Esta tela aparece no lugar do
// formulário quando a assinatura está pendente.
//
// NÃO SUBSTITUI O GATE DA ACTION. As duas camadas coexistem de propósito:
// esta é conveniência e pode ser contornada por quem chamar a action direto;
// a da action é a que decide.
import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { MSG_ASSINATURA_PENDENTE } from '@/lib/billing/mensagens';

export default function BloqueioAssinatura({
  titulo, href, voltarHref, voltarRotulo,
}: {
  /** Título da tela que ficou bloqueada — o usuário tem de reconhecer onde está. */
  titulo: string;
  /** Para onde regularizar. Muda entre escritório e empresa. */
  href: string;
  voltarHref?: string;
  voltarRotulo?: string;
}) {
  return (
    <main className="p-6">
      <h1 className="mb-4 text-2xl font-head font-semibold text-foreground">{titulo}</h1>

      <section className="max-w-prose rounded-md border border-alert/40 bg-alert/10 p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-alert">
          <CreditCard className="size-4 shrink-0" />
          Função indisponível
        </h2>
        <p className="mt-2 text-sm text-alert/90">{MSG_ASSINATURA_PENDENTE}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={href}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Ver assinatura
          </Link>
          {voltarHref && (
            <Link href={voltarHref} className="text-sm text-muted-foreground hover:text-foreground">
              {voltarRotulo ?? 'Voltar'}
            </Link>
          )}
        </div>
      </section>

      {/* As duas fronteiras da spec, ditas em voz alta: sem isto o usuário
          bloqueado supõe que perdeu o app inteiro e liga para o suporte. */}
      <p className="mt-4 max-w-prose text-xs text-muted-foreground">
        Suas obrigações com prazo legal e seus dados continuam liberados — gerar DAS, registrar
        declarações, consultar, exportar e excluir dados não dependem de pagamento.
      </p>
    </main>
  );
}
