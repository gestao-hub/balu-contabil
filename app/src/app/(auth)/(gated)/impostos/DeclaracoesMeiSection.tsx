// @custom — Seção "Declarações" do MEI (DASN-SIMEI). Enquanto a transmissão pela API SERPRO não está
// disponível (TRANSDECLARACAO151 "ainda não disponível para contratação"), oferecemos:
//   (2) fallback manual: link pro portal oficial da Receita p/ declarar;
//   (1) consulta/histórico das declarações já transmitidas (CONSULTIMADECREC152).
import { ExternalLink, CalendarClock } from 'lucide-react';
import { dataBR } from '@/lib/fiscal/guia';
import ConsultarDasnSimeiButton from './ConsultarDasnSimeiButton';
import type { DeclaracaoRow } from './DeclaracoesSection';

// Portal oficial da Receita p/ entregar a DASN-SIMEI (verificado 2026-06-06).
const PORTAL_DASNSIMEI = 'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/dasnsimei.app/';

export default function DeclaracoesMeiSection({
  declaracoes,
  anoCalendario,
}: {
  declaracoes: DeclaracaoRow[];
  anoCalendario: number; // ano-calendário a declarar (normalmente o ano anterior)
}) {
  return (
    <div className="space-y-4">
      {/* (2) Fallback manual enquanto a API de transmissão não está disponível */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <CalendarClock className="size-5 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              Declaração anual do MEI (DASN-SIMEI) — ano-calendário {anoCalendario}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Entregue até <strong>31/05/{anoCalendario + 1}</strong>. É obrigatória mesmo sem faturamento;
              o atraso gera multa (MAED). A transmissão automática pela Balu chega quando a Receita liberar a API —
              por enquanto, declare no portal oficial:
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={PORTAL_DASNSIMEI}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                <ExternalLink className="size-4" />
                Declarar no portal da Receita
              </a>
              <ConsultarDasnSimeiButton />
            </div>
          </div>
        </div>
      </div>

      {/* (1) Histórico das declarações consultadas */}
      {declaracoes.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-md border border-border bg-surface px-4 py-3">
          Nenhuma declaração consultada. Use <strong>“Consultar declarações (SERPRO)”</strong> para buscar as DASN-SIMEI já transmitidas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Ano-calendário</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Nº declaração</th>
                <th className="px-3 py-2 font-medium">Transmitida em</th>
              </tr>
            </thead>
            <tbody>
              {declaracoes.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-3 py-2 tabular-nums">{d.competencia}</td>
                  <td className="px-3 py-2">{d.tipo}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600">
                      Transmitida
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{d.numeroDeclaracao ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{d.dataTransmissao ? dataBR(d.dataTransmissao) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
