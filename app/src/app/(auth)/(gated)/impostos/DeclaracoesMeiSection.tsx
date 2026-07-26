// @custom — Seção "Declarações" do MEI (DASN-SIMEI), assistida.
// O SERPRO Integra Contador CONSULTA declarações; não transmite DASN. O fluxo é
// assistido por definição: o app calcula, confere com as notas, guarda o
// comprovante — a entrega é feita no portal da Receita. Ver spec do Bloco 3, §1.1.
'use client';
import { ExternalLink, Copy } from 'lucide-react';
import { useState } from 'react';
import { dataBR, brl } from '@/lib/fiscal/guia';
import ConsultarDasnSimeiButton from './ConsultarDasnSimeiButton';
import DeclaracaoAnualShell, { type EstadoDeclaracao } from './DeclaracaoAnualShell';
import DasnAssistidaForm from './DasnAssistidaForm';
import RegistrarComprovanteDialog from './RegistrarComprovanteDialog';
import { registrarDeclaracaoAnualAction } from './actions';
import type { DeclaracaoRow } from './DeclaracoesSection';
import type { ResumoReceitas } from '@/lib/fiscal/declaracoes-anuais/tipos';

// Portal oficial da Receita p/ entregar a DASN-SIMEI (verificado 2026-06-06).
const PORTAL_DASNSIMEI = 'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/dasnsimei.app/';

export type DadosDasn = { receitaComercio: number; receitaServico: number; possuiEmpregado: boolean };

export default function DeclaracoesMeiSection({
  declaracoes, anoCalendario, resumo, rascunho,
}: {
  declaracoes: DeclaracaoRow[];
  anoCalendario: number; // ano-calendário a declarar (normalmente o ano anterior)
  resumo: ResumoReceitas;
  rascunho: DadosDasn | null;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  const inicial: DadosDasn = rascunho ?? {
    receitaComercio: resumo.comercio,
    receitaServico: resumo.servico,
    possuiEmpregado: false,
  };

  // O comprovante grava os dados CORRENTES, não os iniciais: quem editou e salvou
  // o rascunho não pode ver a entrega registrar os valores antigos.
  const [dados, setDados] = useState<DadosDasn>(inicial);

  const entregue = declaracoes.find((d) => d.competencia === String(anoCalendario) && d.dataTransmissao);
  const estado: EstadoDeclaracao = entregue
    ? 'entregue'
    : (new Date() > new Date(`${anoCalendario + 1}-05-31T23:59:59-03:00`) ? 'em_atraso' : 'rascunho');

  async function copiarResumo() {
    const txt = [
      `DASN-SIMEI ${anoCalendario}`,
      `Receita de comércio e indústria: ${brl(dados.receitaComercio)}`,
      `Receita de serviços: ${brl(dados.receitaServico)}`,
      `Teve empregado: ${dados.possuiEmpregado ? 'sim' : 'não'}`,
    ].join('\n');
    await navigator.clipboard.writeText(txt);
    setMsg('Resumo copiado.');
  }

  return (
    <div className="space-y-4">
      <DeclaracaoAnualShell
        titulo="Declaração anual do MEI (DASN-SIMEI)"
        anoCalendario={anoCalendario}
        prazo={`31/05/${anoCalendario + 1}`}
        norma="Res. CGSN 140/2018, art. 109 · multa mínima de R$ 25 pelo art. 111"
        estado={estado}
        rodape={
          <>
            <a href={PORTAL_DASNSIMEI} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
              <ExternalLink className="size-4" />
              Declarar no portal da Receita
            </a>
            <button type="button" onClick={copiarResumo}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
              <Copy className="size-4" />
              Copiar resumo
            </button>
            <ConsultarDasnSimeiButton />
            <RegistrarComprovanteDialog
              onSubmit={async ({ numeroDeclaracao, dataTransmissao, comprovante }) =>
                registrarDeclaracaoAnualAction({
                  tipo: 'DASN-SIMEI', ano: anoCalendario, dados,
                  numeroDeclaracao, dataTransmissao, comprovante,
                })}
            />
          </>
        }
      >
        <p className="text-sm text-muted-foreground mb-3">
          É obrigatória mesmo sem faturamento. A Balu monta a declaração, confere com suas notas e
          guarda o comprovante — a entrega é feita no portal da Receita.
        </p>
        <DasnAssistidaForm
          resumo={resumo}
          inicial={inicial}
          onSalvar={async (d) => {
            const r = await registrarDeclaracaoAnualAction({ tipo: 'DASN-SIMEI', ano: anoCalendario, dados: d });
            if (r.ok) {
              setDados(d);
              setMsg('Rascunho salvo. O aviso só some quando você registrar o comprovante.');
            }
            return r;
          }}
        />
        {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
      </DeclaracaoAnualShell>

      {/* Histórico das declarações registradas ou consultadas */}
      {declaracoes.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-md border border-border bg-surface px-4 py-3">
          Nenhuma declaração registrada ainda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Ano-calendário</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Origem</th>
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
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      d.dataTransmissao ? 'bg-green-500/10 text-green-600' : 'bg-surface-3 text-muted-foreground'}`}>
                      {d.dataTransmissao ? 'Transmitida' : 'Rascunho'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{d.origem ?? '—'}</td>
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
