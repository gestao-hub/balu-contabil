// Botões de mandar a fatura para quem NÃO tem o app: o cliente avulso (0108).
//
// São links comuns (wa.me e mailto:) — abrem o WhatsApp e o e-mail DO
// ESCRITÓRIO, com a mensagem pronta, e quem envia é ele. A Balu não manda nada
// em nome de ninguém. Sem estado e sem 'use client': serve à página de
// cobranças (servidor) e ao card de "Usar serviço" (cliente) do mesmo jeito.
import { Mail, MessageCircle } from 'lucide-react';
import { formatBRL } from '@/lib/format/dinheiro';
import { linkEmail, linkWhatsApp, mensagemCobranca } from '@/lib/billing/cliente-avulso';

type Props = {
  nomeCliente: string;
  nomeEscritorio: string | null;
  descricao: string;
  valorCentavos: number;
  /** YYYY-MM-DD. */
  vencimento: string;
  linkFatura: string;
  telefone: string | null;
  email: string | null;
};

const botao =
  'flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 '
  + 'transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary';

export default function CompartilharCobranca(p: Props) {
  const texto = mensagemCobranca({
    nomeCliente: p.nomeCliente,
    nomeEscritorio: p.nomeEscritorio,
    descricao: p.descricao,
    valorFormatado: formatBRL(p.valorCentavos),
    vencimento: p.vencimento.slice(0, 10).split('-').reverse().join('/'),
    linkFatura: p.linkFatura,
  });
  const assunto = `Cobrança: ${p.descricao.trim()}`;

  return (
    <>
      <a
        href={linkWhatsApp(p.telefone, texto)}
        target="_blank"
        rel="noopener noreferrer"
        title={p.telefone ? 'Enviar a fatura pelo WhatsApp' : 'Sem WhatsApp cadastrado — escolha o contato no WhatsApp'}
        className={botao}
      >
        <MessageCircle className="size-3.5" /> WhatsApp
      </a>
      <a
        href={linkEmail(p.email, assunto, texto)}
        title={p.email ? 'Enviar a fatura por e-mail' : 'Sem e-mail cadastrado — preencha o destinatário'}
        className={botao}
      >
        <Mail className="size-3.5" /> E-mail
      </a>
    </>
  );
}
