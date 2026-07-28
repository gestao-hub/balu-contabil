'use client';
// src/app/(auth)/(gated)/contador/honorarios/CobrarHonorarioDialog.tsx
// Bloco 4B — "Gerar cobrança" de um honorário, pela subconta do escritório.
//
// POR CLIQUE, NUNCA POR CRON (decisão explícita do usuário): um laço que
// emitisse a mensalidade da carteira inteira sozinho transformaria qualquer bug
// em dezenas de boletos reais na mão de clientes reais.
//
// SEM CHAVE DE IDEMPOTÊNCIA AQUI, e isso é de propósito: o honorário TEM chave
// natural (o id dele), e é ela que a reserva (`hon:<id>`) e o índice único
// parcial da 0055 usam. Mandar também uma chave de submissão faria a mesma
// dívida ser guardada por dois nomes diferentes. Quem precisa de chave gerada
// no navegador é o serviço AVULSO, que não tem chave natural — ver
// `clientes/[companyId]/CobrarDialog.tsx`.
//
// O VENCIMENTO É EDITÁVEL porque o do honorário pode já ter passado, e o Asaas
// recusa `dueDate` no passado com erro em inglês. Melhor pedir a data nova aqui
// do que devolver "invalid_dueDate" no meio da tela.
import { useEffect, useState, useTransition } from 'react';
import { AlertTriangle } from 'lucide-react';
import PopupConfirm from '@/components/PopupConfirm';
import { formatBRL, valorToCentavos } from '@/lib/format/dinheiro';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { cobrarHonorarioAction } from './cobrar-actions';
import type { HonorarioV2Row } from './HonorarioV2FormDialog';

export type ResultadoCobranca = { linkFatura: string | null; aviso?: string };

type Props = {
  /** `null` = fechado. */
  honorario: HonorarioV2Row | null;
  onFechar: () => void;
  /** Sucesso: quem chama mostra a caixa persistente com o link da fatura. */
  onEmitida: (r: ResultadoCobranca) => void;
};

export default function CobrarHonorarioDialog({ honorario, onFechar, onEmitida }: Props) {
  const hoje = ymdBrt();
  const [vencimento, setVencimento] = useState('');
  // Caixa INLINE, não toast: o toast some em 3s e a recusa aqui costuma vir com
  // o link da cobrança que bloqueou — que o contador precisa poder clicar.
  const [erro, setErro] = useState<{ texto: string; linkFatura: string | null } | null>(null);
  const [pending, start] = useTransition();

  // Reabrir com OUTRO honorário tem de trazer a data dele, não a do anterior.
  useEffect(() => {
    setErro(null);
    const doHonorario = honorario?.data_vencimento ?? '';
    setVencimento(doHonorario && doHonorario >= hoje ? doHonorario : hoje);
  }, [honorario?.id, hoje]);

  if (!honorario) return null;

  const valor = formatBRL(valorToCentavos(honorario.valor));
  const cliente = honorario.companies?.nome || 'este cliente';
  const vencimentoPassou = Boolean(honorario.data_vencimento) && honorario.data_vencimento < hoje;

  function emitir() {
    if (!honorario) return;
    setErro(null);
    if (!vencimento) { setErro({ texto: 'Informe o vencimento da cobrança.', linkFatura: null }); return; }
    if (vencimento < hoje) {
      setErro({ texto: 'O vencimento não pode ser anterior a hoje.', linkFatura: null });
      return;
    }
    start(async () => {
      const r = await cobrarHonorarioAction({ honorarioId: honorario.id, vencimento });
      if (!r.ok) {
        setErro({ texto: r.error, linkFatura: r.linkFatura ?? null });
        return;
      }
      onEmitida({ linkFatura: r.linkFatura, ...(r.aviso ? { aviso: r.aviso } : {}) });
      onFechar();
    });
  }

  return (
    <PopupConfirm
      open
      title="Gerar cobrança do honorário"
      description={`Emitir ${valor} para ${cliente}? A cobrança nasce na conta de recebimento do escritório e o cliente a vê no app.`}
      confirmLabel="Emitir cobrança"
      cancelLabel="Cancelar"
      variant="primary"
      busy={pending}
      onConfirm={emitir}
      onCancel={() => { if (!pending) onFechar(); }}
    >
      <div className="space-y-3">
        <label className="block text-sm text-muted-foreground-2">
          Vencimento
          <input
            type="date"
            value={vencimento}
            min={hoje}
            onChange={(e) => { setVencimento(e.target.value); setErro(null); }}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
          />
        </label>

        {vencimentoPassou && (
          <p className="text-xs text-muted-foreground">
            O vencimento deste honorário já passou — a cobrança sai com a data acima.
          </p>
        )}

        {erro && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              {erro.texto}
              {/* Sem o link o contador não descobre QUAL cobrança bloqueou esta —
                  sobraria caçar no Asaas. */}
              {erro.linkFatura && (
                <>
                  {' '}
                  <a
                    href={erro.linkFatura}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    Ver a cobrança que já existe
                  </a>
                </>
              )}
            </span>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          A cobrança é emitida de verdade, na hora — não há rascunho.
        </p>
      </div>
    </PopupConfirm>
  );
}
