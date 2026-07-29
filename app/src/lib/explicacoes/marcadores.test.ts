import { describe, it, expect } from 'vitest';
import { marcadoresDaChave } from './marcadores';
import { chaveDaSituacao, situacaoDasMei, situacaoPgdas } from '@/lib/fiscal/situacao-fiscal';
import { componentesDasMei } from '@/lib/fiscal/das-mei';

describe('marcadores permitidos por situação', () => {
  it('DAS-MEI: um marcador por componente', () => {
    expect(marcadoresDaChave('das-mei:inss+iss')).toEqual(['inss', 'iss']);
    expect(marcadoresDaChave('das-mei:icms+inss+iss')).toEqual(['icms', 'inss', 'iss']);
  });

  // PGDAS-D nesta rodada explica o total, nao a reparticao entre os tributos do
  // Simples — ela depende de faixa e anexo, e virá quando a apuracao entregar a
  // quebra. Prometer {irpj} agora seria marcador que a tela nao sabe preencher.
  it('PGDAS-D: só o total, nesta rodada', () => {
    expect(marcadoresDaChave('pgdas:anexo-iii+fator-r')).toEqual(['total']);
    expect(marcadoresDaChave('pgdas:anexo-i')).toEqual(['total']);
  });

  // A LIGACAO QUE IMPORTA: o que a tela consegue preencher para o DAS-MEI sao
  // exatamente as chaves de `componentesDasMei`. Se um dia nascer um componente
  // novo (CPP, por exemplo), este teste morde e obriga a decidir — em vez de o
  // marcador aparecer cru na tela do contribuinte.
  it.each(['Comercio ou Industria', 'Prestacao de Servicos', 'Comercio e Servicos'] as const)(
    'os marcadores de %s são exatamente os componentes que a tela sabe preencher',
    (atividade) => {
      const chave = chaveDaSituacao(situacaoDasMei(atividade));
      expect(marcadoresDaChave(chave)).toEqual(Object.keys(componentesDasMei(atividade)).sort());
    },
  );

  // Ordem alfabetica e estavel: o prompt lista os marcadores nesta ordem, e um
  // prompt que muda sozinho produziria rascunhos diferentes para a mesma
  // situacao sem ninguem ter mudado nada.
  it('a ordem é alfabética e estável', () => {
    const m = marcadoresDaChave('das-mei:iss+icms+inss');
    expect(m).toEqual([...m].sort());
    expect(marcadoresDaChave('das-mei:icms+inss+iss')).toEqual(m);
  });

  // O Fator R muda a EXPLICACAO (e por isso esta na chave), mas nao acrescenta
  // valor nenhum para a tela preencher.
  it('Fator R não cria marcador', () => {
    expect(marcadoresDaChave(chaveDaSituacao(situacaoPgdas('Anexo III', true))))
      .toEqual(marcadoresDaChave(chaveDaSituacao(situacaoPgdas('Anexo III', false))));
  });

  // Chave que nao se reconhece nao ganha marcador nenhum: aprovar um texto com
  // marcador contra uma situacao desconhecida seria aprovar no escuro.
  it.each(['', 'irpf:algo', 'sem-dois-pontos', 'das-mei:'])(
    'chave inválida (%s) não permite marcador nenhum',
    (k) => expect(marcadoresDaChave(k)).toEqual([]),
  );
});
