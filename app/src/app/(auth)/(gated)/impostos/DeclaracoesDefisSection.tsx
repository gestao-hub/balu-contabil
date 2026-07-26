// DEFIS das ME/EPP do Simples. Não há consulta SERPRO para o DEFIS — o fluxo é
// integralmente assistido (spec §5.2).
'use client';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import DeclaracaoAnualShell, { type EstadoDeclaracao } from './DeclaracaoAnualShell';
import DefisForm from './DefisForm';
import RegistrarComprovanteDialog from './RegistrarComprovanteDialog';
import { registrarDeclaracaoAnualAction } from './actions';
import type { DeclaracaoRow } from './DeclaracoesSection';

// O DEFIS é módulo do PGDAS-D e mora sob ATSPO, não sob um app próprio: este é o
// destino do link "Acessar a DEFIS" de dentro do PGDAS-D 2018 (verificado
// 2026-07-26 — responde com o gate de login, não 404). Exige e-CAC ou código de
// acesso; diferente da DASN-SIMEI, não há entrada pública por CNPJ.
const PORTAL_DEFIS = 'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/defis.app/entrada.aspx';

export default function DeclaracoesDefisSection({ declaracoes, anoCalendario, inicial }: {
  declaracoes: DeclaracaoRow[];
  anoCalendario: number;
  inicial: Record<string, unknown>;
}) {
  const [dados, setDados] = useState<Record<string, unknown>>(inicial);
  const [msg, setMsg] = useState<string | null>(null);

  const entregue = declaracoes.find((d) => d.competencia === String(anoCalendario) && d.dataTransmissao);
  const estado: EstadoDeclaracao = entregue
    ? 'entregue'
    : (new Date() > new Date(`${anoCalendario + 1}-03-31T23:59:59-03:00`) ? 'em_atraso' : 'rascunho');

  return (
    <DeclaracaoAnualShell
      titulo="Declaração de informações socioeconômicas e fiscais (DEFIS)"
      anoCalendario={anoCalendario}
      prazo={`31/03/${anoCalendario + 1}`}
      norma="Res. CGSN 140/2018, art. 72"
      estado={estado}
      rodape={
        <>
          <a href={PORTAL_DEFIS} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            <ExternalLink className="size-4" />
            Declarar no portal do Simples
          </a>
          <RegistrarComprovanteDialog
            onSubmit={async ({ numeroDeclaracao, dataTransmissao, comprovante }) =>
              registrarDeclaracaoAnualAction({
                tipo: 'DEFIS', ano: anoCalendario, dados, numeroDeclaracao, dataTransmissao, comprovante,
              })}
          />
        </>
      }
    >
      <p className="text-sm text-muted-foreground mb-3">
        Obrigatória para ME e EPP do Simples, mesmo sem faturamento. A Balu monta a declaração e guarda
        o comprovante — a entrega é feita no portal do Simples, com acesso pelo e-CAC ou código de acesso.
      </p>
      <DefisForm
        inicial={inicial}
        onSalvar={async (d) => {
          const r = await registrarDeclaracaoAnualAction({ tipo: 'DEFIS', ano: anoCalendario, dados: d });
          if (r.ok) {
            setDados(d);
            setMsg('Rascunho salvo. O aviso só some quando você registrar o comprovante.');
          }
          return r;
        }}
      />
      {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
    </DeclaracaoAnualShell>
  );
}
