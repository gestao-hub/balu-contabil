import { describe, it, expect } from 'vitest';
import { traduzirErroSerpro, extrairMensagensSerpro } from './serpro-erro';

// A FORMA QUE CHEGA EM PRODUÇÃO. `lib/clients/serpro.ts` desembrulha o envelope
// antes de lançar e entrega `[codigo] texto | [codigo] texto`. A primeira versão
// destes testes só exercitava o JSON cru — que praticamente nunca chega aqui —,
// e por isso a tabela de códigos passava nos testes sendo inalcançável no app.
const prod = (...msgs: string[]) => `SERPRO /Declarar → 400: ${msgs.join(' | ')}`;

describe('forma pré-parseada pelo client (a de produção)', () => {
  it('reconhece código e texto sem JSON nenhum', () => {
    expect(extrairMensagensSerpro(prod('[Erro-PGDASD-X1] Receita acima do limite'))).toEqual([
      { codigo: 'Erro-PGDASD-X1', texto: 'Receita acima do limite' },
    ]);
  });

  it('a tabela DASN-SIMEI dispara nesta forma — era o ponto cego', () => {
    expect(traduzirErroSerpro(prod('[Aviso-DASNSIMEI-10008] receita acima'))).toMatch(/desenquadramento/i);
  });

  it('separa várias mensagens pelo pipe', () => {
    expect(extrairMensagensSerpro(prod('[Aviso-A-1] um', '[Erro-B-2] dois'))).toHaveLength(2);
  });

  it('texto solto sem código não vira mensagem falsa', () => {
    expect(extrairMensagensSerpro(prod('alguma coisa sem código'))).toEqual([]);
  });
});

describe('extrairMensagensSerpro', () => {
  it('lê o envelope completo', () => {
    const raw =
      'SERPRO /Declarar → 400: {"status":"400","mensagens":[{"codigo":"[Aviso-PGDASD-MSG_E0139]","texto":"Não foi gerado DAS."}]}';
    expect(extrairMensagensSerpro(raw)).toEqual([
      { codigo: '[Aviso-PGDASD-MSG_E0139]', texto: 'Não foi gerado DAS.' },
    ]);
  });

  it('garimpa por regex quando o JSON veio CORTADO no meio', () => {
    // Os wrappers cortavam em 160 chars — o parse falha e mesmo assim a
    // mensagem precisa sobreviver.
    const cortado =
      'SERPRO /Declarar → 400: {"status":"400","mensagens":[{"codigo":"[Erro-PGDASD-X1]","texto":"Receita maior que o limite"}],"dado';
    expect(extrairMensagensSerpro(cortado)).toEqual([
      { codigo: '[Erro-PGDASD-X1]', texto: 'Receita maior que o limite' },
    ]);
  });

  it('devolve vazio quando não há JSON nenhum', () => {
    expect(extrairMensagensSerpro('ETIMEDOUT')).toEqual([]);
    expect(extrairMensagensSerpro('')).toEqual([]);
  });

  it('ignora entrada sem codigo nem texto em vez de devolver lixo', () => {
    expect(extrairMensagensSerpro('{"mensagens":[{},{"codigo":"A","texto":"b"}]}')).toEqual([
      { codigo: 'A', texto: 'b' },
    ]);
  });
});

describe('traduzirErroSerpro — transporte', () => {
  it('401 vira recado para o suporte, não tarefa para o contribuinte', () => {
    // Token nosso expirado não é problema que o cliente resolva; mandá-lo
    // "tentar de novo" seria empurrá-lo para um loop.
    expect(traduzirErroSerpro('SERPRO /Declarar → 401: unauthorized')).toMatch(/suporte/i);
  });

  it('403 aponta para a procuração no e-CAC', () => {
    expect(traduzirErroSerpro('SERPRO /Emitir → 403: forbidden')).toMatch(/procuração/i);
  });

  it('5xx e timeout dizem que nada foi perdido', () => {
    expect(traduzirErroSerpro('SERPRO /Apoiar → 502: bad gateway')).toMatch(/instável/i);
    expect(traduzirErroSerpro('ETIMEDOUT')).toMatch(/demorou/i);
  });

  it('falta de configuração não vira culpa do usuário', () => {
    expect(traduzirErroSerpro('SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET não configurados'))
      .toMatch(/suporte/i);
  });
});

describe('traduzirErroSerpro — códigos documentados', () => {
  const envelope = (codigo: string, texto = 'texto oficial') =>
    `SERPRO /Declarar → 400: {"mensagens":[{"codigo":"${codigo}","texto":"${texto}"}]}`;

  it('10008 (receita acima do teto) sai como alerta forte de desenquadramento', () => {
    const r = traduzirErroSerpro(envelope('[Aviso-DASNSIMEI-10008]'));
    expect(r).toMatch(/desenquadramento/i);
    expect(r).toMatch(/contabilidade/i);
  });

  it('10002 explica a decadência em vez de repetir "ano inválido"', () => {
    expect(traduzirErroSerpro(envelope('Aviso-DASNSIMEI-10002'))).toMatch(/6 anos/);
  });

  it('10006 encaminha para o PGMEI', () => {
    expect(traduzirErroSerpro(envelope('[Aviso-DASNSIMEI-10006]'))).toMatch(/PGMEI/);
  });

  it('aceita com e sem colchetes, e em qualquer caixa', () => {
    const a = traduzirErroSerpro(envelope('[Aviso-DASNSIMEI-33001]'));
    const b = traduzirErroSerpro(envelope('aviso-dasnsimei-33001'));
    expect(a).toBe(b);
    expect(a).toMatch(/SIMEI/);
  });
});

describe('traduzirErroSerpro — código sem significado verificado', () => {
  it('mostra o texto oficial da SERPRO em vez de inventar tradução', () => {
    const raw =
      'SERPRO /Declarar → 400: {"mensagens":[{"codigo":"[Erro-PGDASD-MSG_9999]","texto":"Período de apuração encerrado."}]}';
    const r = traduzirErroSerpro(raw);
    expect(r).toMatch(/Período de apuração encerrado\./);
  });

  it('preserva o código — é ele que o contador leva ao suporte da Receita', () => {
    const raw = 'SERPRO /Declarar → 400: {"mensagens":[{"codigo":"[Erro-PGDASD-MSG_9999]","texto":"Qualquer coisa."}]}';
    expect(traduzirErroSerpro(raw)).toMatch(/ERRO-PGDASD-MSG_9999/);
  });

  it('prefere a mensagem de erro quando vem junto com um "Sucesso"', () => {
    const raw =
      'SERPRO /Declarar → 400: {"mensagens":[{"codigo":"[Sucesso-PGDASD]","texto":"ok"},{"codigo":"[Erro-PGDASD-Z]","texto":"Falhou de verdade."}]}';
    expect(traduzirErroSerpro(raw)).toMatch(/Falhou de verdade/);
  });

  it('código sem texto ainda produz frase utilizável', () => {
    expect(traduzirErroSerpro('{"mensagens":[{"codigo":"[Erro-X-1]","texto":""}]}')).toMatch(/ERRO-X-1/);
  });
});

describe('traduzirErroSerpro — fallback', () => {
  it('nunca devolve o envelope de transporte cru', () => {
    const r = traduzirErroSerpro('SERPRO /Declarar → 400: resposta ininteligível');
    expect(r).not.toMatch(/→ 400/);
    expect(r).toMatch(/resposta ininteligível/);
  });

  it('corta para não despejar payload na tela', () => {
    const raw = `SERPRO /Declarar → 400: ${'x'.repeat(5000)}`;
    expect(traduzirErroSerpro(raw).length).toBeLessThan(260);
  });

  it('entrada vazia não vira string vazia na UI', () => {
    expect(traduzirErroSerpro('')).toMatch(/não explicou/);
  });
});

describe('regressões apontadas na revisão', () => {
  const prodMsg = (...m: string[]) => `SERPRO /Declarar → 400: ${m.join(' | ')}`;

  it('ERRO vence AVISO quando os dois vêm juntos', () => {
    // O aviso costuma ser ressalva informativa e vem ANTES no envelope;
    // mostrá-lo esconderia o motivo real da falha.
    const r = traduzirErroSerpro(prodMsg('[Aviso-PGDASD-E1] Recebida com ressalvas.', '[Erro-PGDASD-X] CNPJ bloqueado.'));
    expect(r).toMatch(/CNPJ bloqueado/);
    expect(r).not.toMatch(/ressalvas/);
  });

  it('palavra de transporte DENTRO do texto da Receita não vira frase de infra', () => {
    // Um 400 legítimo falando de "procuração" precisa continuar mostrando o
    // texto oficial, e não a frase genérica de e-CAC.
    const r = traduzirErroSerpro(prodMsg('[Erro-PGDASD-Z] Prazo de entrega esgotado por timeout do sistema.'));
    expect(r).toMatch(/Prazo de entrega esgotado/);
    expect(r).not.toMatch(/demorou demais/);
  });

  it('timeout de rede real (sem status) continua sendo tratado como transporte', () => {
    expect(traduzirErroSerpro('SERPRO /Declarar: timeout (25s).')).toMatch(/demorou/i);
  });

  it('JSON cortado NO MEIO do texto ainda é salvo', () => {
    const cortado = 'SERPRO /Declarar → 400: {"mensagens":[{"codigo":"[Erro-A-1]","texto":"Mensagem que foi corta';
    expect(traduzirErroSerpro(cortado)).toMatch(/Mensagem que foi corta/);
  });

  it('envelope ilegível NÃO vaza JSON para a tela', () => {
    const r = traduzirErroSerpro('SERPRO /Declarar → 400: {"status":"400","dados":"lixo');
    expect(r).not.toMatch(/[{[]/);
    expect(r).toMatch(/não foi possível interpretar/i);
  });

  it('resposta não-JSON tem o prefixo de transporte removido', () => {
    const r = traduzirErroSerpro('SERPRO /Declarar retornou não-JSON: Service Unavailable');
    expect(r).not.toMatch(/retornou não-JSON/);
    expect(r).toMatch(/Service Unavailable/);
  });
});
