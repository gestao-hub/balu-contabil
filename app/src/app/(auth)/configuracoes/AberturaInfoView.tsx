// src/app/(auth)/configuracoes/AberturaInfoView.tsx
'use client';
import { useState } from 'react';
import AlteracaoDialog from './AlteracaoDialog';

const ETAPAS = ['recebido','em_analise','pendente_documentos','enviado_receita','enviado_junta','enviado_prefeitura','concluido'] as const;
const ETAPA_LABEL: Record<string, string> = {
  recebido: 'Recebido', em_analise: 'Em análise', pendente_documentos: 'Documentos pendentes',
  enviado_receita: 'Enviado à Receita', enviado_junta: 'Na Junta Comercial',
  enviado_prefeitura: 'Na Prefeitura', concluido: 'Concluído', cancelado: 'Cancelado',
};

export default function AberturaInfoView({ abertura }: { abertura: Record<string, unknown> }) {
  const [showAlteracao, setShowAlteracao] = useState(false);
  const etapa = String(abertura.processo_etapa ?? 'recebido');
  const idx = ETAPAS.indexOf(etapa as (typeof ETAPAS)[number]);

  const row = (label: string, value: unknown) => (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value ? String(value) : '—'}</span>
    </div>
  );

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium text-foreground mb-3">Status da abertura</h2>
        {etapa === 'cancelado' ? (
          <p className="text-sm text-destructive">Solicitação cancelada.</p>
        ) : (
          <ol className="flex flex-wrap gap-2">
            {ETAPAS.map((e, i) => (
              <li key={e} className={`text-xs px-2 py-1 rounded-full border ${i <= idx ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                {ETAPA_LABEL[e]}
              </li>
            ))}
          </ol>
        )}
        {!!abertura.processo_protocolo && <p className="text-xs text-muted-foreground mt-2">Protocolo: {abertura.processo_protocolo as string}</p>}
        {!!abertura.processo_observacoes && <p className="text-xs text-muted-foreground mt-1">Obs.: {abertura.processo_observacoes as string}</p>}
        {!!abertura.processo_cnpj_emitido && <p className="text-xs text-foreground mt-1">CNPJ emitido: {abertura.processo_cnpj_emitido as string}</p>}
      </section>

      <section>
        <h2 className="text-sm font-medium text-foreground mb-3">Dados enviados</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {row('Titular', abertura.titular_nome_completo)}
          {row('CPF', abertura.titular_cpf)}
          {row('Telefone', abertura.titular_telefone)}
          {row('E-mail', abertura.titular_email)}
          {row('Razão social (1)', abertura.empresa_razao_social_1)}
          {row('Nome fantasia', abertura.empresa_nome_fantasia)}
          {row('Tipo', abertura.empresa_tipo)}
          {row('Regime', abertura.empresa_regime_tributario)}
          {row('Capital social', abertura.empresa_capital_social)}
          {row('CNAE principal', abertura.empresa_cnae_principal)}
        </div>
      </section>

      <div>
        <button
          type="button"
          onClick={() => setShowAlteracao(true)}
          className="px-4 py-2 text-sm rounded-lg border border-border text-foreground hover:bg-surface-2"
        >
          Solicitar alteração de dados
        </button>
      </div>

      <AlteracaoDialog
        open={showAlteracao}
        onClose={() => setShowAlteracao(false)}
      />
    </div>
  );
}
