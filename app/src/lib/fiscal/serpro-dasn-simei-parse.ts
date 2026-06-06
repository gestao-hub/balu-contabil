// Parser puro da resposta do DASN-SIMEI / TRANSDECLARACAO151 (entregar) e CONSULTIMADECREC152.
// O envelope traz `dados` como STRING JSON (às vezes já objeto). Sem rede.
//
// ⚠️ MODELADO PELA DOC: o DASN-SIMEI não está no Trial (101507), então os nomes de campos
// (idDeclaracao, dataTransmissao, codigoTipoDeclaracao, excessoReceitaBruta, multaAtrasoEntrega)
// vêm da doc oficial, NÃO de um envelope real. Os PDFs aninhados (recibo/DARF) ficam como
// follow-up — extrair quando houver resposta real. Ver docs/investigations/DASN-SIMEI.md.

export type DasnSimeiResult = {
  numeroDeclaracao: string | null; // idDeclaracao
  dataTransmissao: string | null; // ISO
  tipoDeclaracao: number | null; // codigoTipoDeclaracao (1=Original, 2=Retificadora)
  nomeEmpresarial: string | null;
  temExcesso: boolean; // excessoReceitaBruta presente → há DAS de excesso
  temMaed: boolean; // multaAtrasoEntrega presente → multa por atraso na entrega
  desenquadramento: boolean; // Aviso-DASNSIMEI-10008 (receita acima do teto MEI)
  mensagens: string[]; // "codigo: texto" das mensagens da SERPRO
};

function isoFromData(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  if (/^\d{14}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s; // não perde o dado em formato desconhecido
}

export function parseDasnSimei(envelope: unknown): DasnSimeiResult {
  const env = (envelope ?? {}) as { dados?: unknown; mensagens?: unknown };

  const mensagens = Array.isArray(env.mensagens)
    ? env.mensagens
        .map((m) => {
          const o = (m ?? {}) as { codigo?: unknown; texto?: unknown };
          return [o.codigo, o.texto].filter((x) => typeof x === 'string').join(': ');
        })
        .filter(Boolean)
    : [];
  const desenquadramento = mensagens.some((m) => m.includes('10008'));

  let dados: unknown = env.dados;
  if (typeof dados === 'string') {
    try {
      dados = JSON.parse(dados);
    } catch {
      throw new Error('DASN-SIMEI: `dados` em formato inválido.');
    }
  }
  const decl = (Array.isArray(dados) ? dados[0] : dados) as Record<string, unknown> | undefined;
  const d = decl ?? {};

  return {
    numeroDeclaracao: typeof d.idDeclaracao === 'string' ? d.idDeclaracao : null,
    dataTransmissao: isoFromData(d.dataTransmissao),
    tipoDeclaracao: typeof d.codigoTipoDeclaracao === 'number' ? d.codigoTipoDeclaracao : null,
    nomeEmpresarial: typeof d.nomeEmpresarial === 'string' ? d.nomeEmpresarial : null,
    temExcesso: d.excessoReceitaBruta != null,
    temMaed: d.multaAtrasoEntrega != null,
    desenquadramento,
    mensagens,
  };
}
