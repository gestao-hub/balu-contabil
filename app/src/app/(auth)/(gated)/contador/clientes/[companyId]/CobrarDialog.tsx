'use client';
// src/app/(auth)/(gated)/contador/clientes/[companyId]/CobrarDialog.tsx
// Bloco 4B — emitir cobrança avulsa deste cliente pela subconta do escritório.
//
// ┌─ A CHAVE DE IDEMPOTÊNCIA NASCE AQUI, E SÓ AQUI ────────────────────────┐
// │ O serviço avulso NÃO TEM chave natural: cobrar duas vezes a mesma      │
// │ consultoria do mesmo cliente é legítimo. Quem separa "duplo clique" de │
// │ "cobrar de novo" é um UUID gerado NESTA TELA:                          │
// │                                                                        │
// │   * nasce UMA VEZ POR ABERTURA do formulário (`abrir()`);              │
// │   * viaja em `idempotencyKey` a cada envio;                            │
// │   * é RENOVADO só depois de uma emissão BEM-SUCEDIDA — nunca depois de │
// │     um erro, porque tentar de novo com a MESMA chave é justamente o    │
// │     que impede o segundo boleto quando a primeira tentativa falhou de  │
// │     forma ambígua (5xx, timeout) e a cobrança pode ter nascido.        │
// │                                                                        │
// │ É dela que `emitir-cobranca.ts` tira a reserva tomada ANTES do Asaas e │
// │ o índice único parcial da 0055. Sem ela o caminho do avulso não tem    │
// │ trava nenhuma: dois cliques viram dois boletos reais.                  │
// │                                                                        │
// │ Por isso, também, o formulário FALHA FECHADO quando o navegador não    │
// │ sabe gerar UUID: sem chave preferimos não emitir a emitir sem trava.   │
// └────────────────────────────────────────────────────────────────────────┘
//
// SÓ IMPORTA MÓDULO PURO (`@/lib/billing/avulso`, `@/lib/format/dinheiro`,
// `@/lib/fiscal/tempo-brt`) e a action. Módulo com `server-only` importado daqui
// passa no `tsc --noEmit` e só quebra no runtime — mordeu o Bloco 4A.
//
// VALOR EM TEXTO, não `type="number"`: o escritório digita "1.200,50" e o input
// numérico do navegador em pt-BR ora aceita ora recusa a vírgula conforme o
// locale. Mesmo caminho do catálogo (`normalizarValorBRL`) — o que trafega é
// centavo inteiro.
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Receipt, X } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { formatBRL, normalizarValorBRL } from '@/lib/format/dinheiro';
import { valorFinalCentavos, type TipoValor } from '@/lib/billing/avulso';
import { novaChaveEmissao } from '@/lib/billing/chave-emissao';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { cobrarClienteAction } from './cobrar-actions';

export type ServicoOpcao = {
  id: string;
  nome: string;
  tipoValor: TipoValor;
  valorCentavos: number | null;
  percentual: number | null;
};

type Props = {
  companyId: string;
  /** Só os ATIVOS: serviço desativado saiu da emissão de propósito, e a action
   *  recusa se ele chegar mesmo assim. */
  servicos: ServicoOpcao[];
  podeCobrar: boolean;
  /** Por que não pode — dito na ENTRADA, não depois de preencher o formulário. */
  motivoBloqueio: string | null;
  /** Para onde ir para resolver o bloqueio (assinatura, subconta). */
  linkBloqueio: { href: string; rotulo: string } | null;
};

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';

/** Texto livre em reais → centavos inteiros. `null` quando não sobra número. */
function centavosDoTexto(texto: string): number | null {
  const s = normalizarValorBRL(texto);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return c > 0 ? c : null;
}

export default function CobrarDialog({
  companyId, servicos, podeCobrar, motivoBloqueio, linkBloqueio,
}: Props) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  /** A chave DESTA abertura do formulário. Ver o cabeçalho. */
  const [chave, setChave] = useState<string | null>(null);
  const [servicoId, setServicoId] = useState('');
  const [valorTexto, setValorTexto] = useState('');
  const [descricao, setDescricao] = useState('');
  const [vencimento, setVencimento] = useState('');
  // Caixa INLINE e persistente, não só toast: o toast some em 3s e mensagem
  // sobre dinheiro emitido não pode sumir da tela.
  const [erro, setErro] = useState<{ texto: string; linkFatura: string | null } | null>(null);
  const [sucesso, setSucesso] = useState<{ linkFatura: string | null } | null>(null);
  const [pending, start] = useTransition();

  const hoje = ymdBrt();
  const servico = servicos.find((s) => s.id === servicoId) ?? null;
  // Sem serviço, o campo é o VALOR da cobrança livre; com serviço percentual,
  // é o valor-base sobre o qual a porcentagem incide. Serviço fixo já tem preço.
  const precisaValor = !servico || servico.tipoValor === 'percentual';
  const baseCentavos = centavosDoTexto(valorTexto);
  const previsto = servico
    ? valorFinalCentavos(servico, baseCentavos)
    : baseCentavos;

  function abrir() {
    // A CHAVE NASCE AQUI — uma por abertura.
    setChave(novaChaveEmissao());
    setServicoId('');
    setValorTexto('');
    setDescricao('');
    setVencimento(hoje);
    setErro(null);
    setSucesso(null);
    setAberto(true);
  }

  function emitir() {
    setErro(null);
    setSucesso(null);

    // FALHA FECHADA: sem chave não há reserva antes do Asaas nem índice único
    // depois — dois cliques virariam dois boletos reais.
    if (!chave) {
      const t = 'Este navegador não conseguiu gerar a chave de segurança da emissão. '
        + 'Atualize a página ou use outro navegador — cobrar sem ela arriscaria emitir duas vezes.';
      setErro({ texto: t, linkFatura: null });
      toast('error', t);
      return;
    }

    // As mesmas regras que a action aplica — em português e sem round-trip.
    if (!vencimento) {
      setErro({ texto: 'Informe o vencimento.', linkFatura: null });
      return;
    }
    if (vencimento < hoje) {
      setErro({ texto: 'O vencimento não pode ser anterior a hoje.', linkFatura: null });
      return;
    }
    if (servico?.tipoValor === 'percentual' && baseCentavos == null) {
      setErro({
        texto: 'Este serviço é percentual — informe o valor-base da cobrança.',
        linkFatura: null,
      });
      return;
    }
    // `valorFinalCentavos` devolve `null` para zero e negativo de propósito
    // (0,01% de R$ 1,00 arredonda para 0): emitir por zero é pior que recusar,
    // porque sai de graça sem ninguém notar. Não há número forçado aqui.
    if (previsto == null) {
      setErro({
        texto: servico?.tipoValor === 'percentual'
          ? 'Esse valor-base dá uma cobrança de R$ 0,00 — confira o valor antes de emitir.'
          // Serviço fixo sem preço no catálogo: não há campo nesta tela para
          // consertar isso, então a frase manda para onde dá (mesma da action).
          : servico
            ? 'Este serviço está sem valor no catálogo — corrija-o antes de cobrar.'
            : 'Informe o valor da cobrança.',
        linkFatura: null,
      });
      return;
    }
    if (!(descricao.trim() || servico?.nome)) {
      setErro({ texto: 'Descreva o que está sendo cobrado.', linkFatura: null });
      return;
    }

    start(async () => {
      const r = await cobrarClienteAction({
        companyId,
        servicoAvulsoId: servicoId || null,
        descricaoLivre: descricao.trim() || null,
        baseCentavos: precisaValor ? baseCentavos : null,
        vencimento,
        idempotencyKey: chave,
      });

      if (!r.ok) {
        // A chave NÃO é renovada aqui: tentar de novo com a mesma chave é o que
        // impede o segundo boleto quando a falha foi ambígua e a cobrança pode
        // ter nascido no Asaas.
        setErro({ texto: r.error, linkFatura: r.linkFatura ?? null });
        toast('error', r.error);
        return;
      }

      // EMISSÃO BEM-SUCEDIDA: só agora a chave é renovada — daqui em diante,
      // "cobrar de novo" é outra submissão, legítima e distinta.
      setChave(novaChaveEmissao());
      setServicoId('');
      setValorTexto('');
      setDescricao('');
      setSucesso({ linkFatura: r.linkFatura });
      toast('success', 'Cobrança emitida.');
    });
  }

  if (!podeCobrar) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-start gap-2 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          {motivoBloqueio ?? 'Cobrança indisponível para este escritório no momento.'}
          {linkBloqueio && (
            <>
              {' '}
              <Link href={linkBloqueio.href} className="font-medium underline">
                {linkBloqueio.rotulo}
              </Link>
            </>
          )}
        </span>
      </div>
    );
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={abrir}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2"
      >
        <Receipt className="size-4" /> Cobrar este cliente
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Cobrar este cliente</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A cobrança nasce na conta de recebimento do escritório — o dinheiro cai direto na
            conta dele, e o cliente vê a fatura no app.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAberto(false)}
          disabled={pending}
          title="Fechar"
          className="rounded-md p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={rotuloCampo}>Serviço do catálogo</span>
          <select
            value={servicoId}
            // Trocar de serviço LIMPA o valor: o valor-base de um percentual
            // não é o preço de outro serviço, e um número esquecido do serviço
            // anterior sairia como cobrança real sem ninguém ver de onde veio.
            onChange={(e) => { setServicoId(e.target.value); setValorTexto(''); setErro(null); }}
            className={campo}
          >
            <option value="">Cobrança avulsa (valor livre)</option>
            {servicos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
                {s.tipoValor === 'percentual'
                  ? ` — ${s.percentual}% do valor-base`
                  : ` — ${formatBRL(s.valorCentavos ?? 0)}`}
              </option>
            ))}
          </select>
          {servicos.length === 0 && (
            <span className="text-xs text-muted-foreground">
              Nenhum serviço no catálogo ainda — dá para cobrar por valor livre do mesmo jeito.
            </span>
          )}
        </label>

        {precisaValor && (
          <label className="flex flex-col gap-1">
            <span className={rotuloCampo}>
              {servico?.tipoValor === 'percentual' ? 'Valor-base (R$)' : 'Valor (R$)'}
              <span className="text-destructive"> *</span>
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={valorTexto}
              onChange={(e) => setValorTexto(e.target.value)}
              placeholder="1.200,00"
              className={campo}
            />
            {servico?.tipoValor === 'percentual' && (
              <span className="text-xs text-muted-foreground">
                O valor sobre o qual os {servico.percentual}% incidem — o crédito recuperado, o
                serviço a que a urgência se aplica.
              </span>
            )}
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>Vencimento<span className="text-destructive"> *</span></span>
          <input
            type="date"
            value={vencimento}
            min={hoje}
            onChange={(e) => { setVencimento(e.target.value); setErro(null); }}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={rotuloCampo}>
            Descrição{!servico && <span className="text-destructive"> *</span>}
          </span>
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={servico?.nome ?? 'Ex.: hora técnica de consultoria'}
            maxLength={200}
            className={campo}
          />
          <span className="text-xs text-muted-foreground">
            É o que o cliente lê na fatura.
          </span>
        </label>
      </div>

      {/* O valor que VAI SAIR, calculado pela mesma função do servidor. Num
          serviço percentual, é a única forma de o escritório conferir a conta
          antes de o boleto existir. */}
      <p className="text-sm text-foreground">
        Valor da cobrança:{' '}
        <strong className="tabular-nums">{previsto == null ? '—' : formatBRL(previsto)}</strong>
      </p>

      {erro && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {erro.texto}
            {/* Sem o link, o contador não descobre QUAL cobrança bloqueou esta —
                sobraria caçar no Asaas. */}
            {erro.linkFatura && (
              <>
                {' '}
                <a
                  href={erro.linkFatura}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline"
                >
                  Ver a fatura que já existe <ExternalLink className="size-3" />
                </a>
              </>
            )}
          </span>
        </div>
      )}

      {sucesso && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>
            Cobrança emitida. O cliente já a vê no app dele.
            {sucesso.linkFatura && (
              <>
                {' '}
                <a
                  href={sucesso.linkFatura}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline"
                >
                  Abrir a fatura <ExternalLink className="size-3" />
                </a>
              </>
            )}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={emitir}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />}
          {pending ? 'Emitindo…' : 'Emitir cobrança'}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          disabled={pending}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
        >
          Fechar
        </button>
        <p className="text-xs text-muted-foreground">
          A cobrança é emitida de verdade, na hora — não há rascunho.
        </p>
      </div>
    </div>
  );
}
