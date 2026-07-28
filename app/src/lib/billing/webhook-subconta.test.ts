// Bloco 4B — regras do webhook da subconta.
//
// O que estes testes protegem, em ordem de estrago:
//  1. o payload sair sem `authToken` — o Asaas GERA um sozinho, responde 200 e
//     `hasAuthToken: true`, e toda entrega passa a morrer no `unauthorized` da
//     nossa rota. Sucesso aparente, silencio total;
//  2. a lista de eventos divergir de `traduzirEvento` (lib/billing/eventos.ts);
//  3. `localhost` virar webhook cadastrado de verdade;
//  4. o diagnostico chamar de 'ok' um webhook interrompido/desligado.
import { describe, it, expect } from 'vitest';
import type { AsaasWebhook } from '@/lib/clients/asaas';
import {
  EVENTOS_WEBHOOK, MIN_SEGREDO, NOME_WEBHOOK,
  diagnosticarWebhook, ehUrlEntregavel, montarPayloadWebhook, precisaReparo,
  segredoUtilizavel, urlWebhookSubconta, avisoDoDiagnostico,
  type DiagnosticoWebhook,
} from './webhook-subconta';

const URL_OK = 'https://app.balu.com.br/api/webhooks/asaas';
const SEGREDO = 'x'.repeat(MIN_SEGREDO);

function webhook(over: Partial<AsaasWebhook> = {}): AsaasWebhook {
  return {
    id: 'wh_1',
    name: NOME_WEBHOOK,
    url: URL_OK,
    email: 'ops@balu.com.br',
    enabled: true,
    interrupted: false,
    hasAuthToken: true,
    sendType: 'SEQUENTIALLY',
    penalizedRequestsCount: 0,
    events: [...EVENTOS_WEBHOOK],
    ...over,
  };
}

describe('urlWebhookSubconta', () => {
  it('monta o caminho da rota que ja existe', () => {
    expect(urlWebhookSubconta('https://app.balu.com.br')).toBe(URL_OK);
  });

  // A base vem de env; uma barra sobrando produziria `//api/...`, que o Asaas
  // cadastra numa url diferente da que o diagnostico procura — webhook duplicado
  // e diagnostico eternamente 'ausente'.
  it('nao duplica a barra quando a base ja termina com uma', () => {
    expect(urlWebhookSubconta('https://app.balu.com.br/')).toBe(URL_OK);
  });
});

describe('ehUrlEntregavel', () => {
  it('aceita https com host publico', () => {
    expect(ehUrlEntregavel(URL_OK)).toBe(true);
  });

  // O caso de dev. O Asaas aceita cadastrar sem conferir se a url responde —
  // sem esta guarda, `npm run dev` deixaria lixo permanente no painel do Asaas
  // do escritorio.
  it('recusa localhost', () => {
    expect(ehUrlEntregavel('http://localhost:3000/api/webhooks/asaas')).toBe(false);
    expect(ehUrlEntregavel('https://localhost:3000/api/webhooks/asaas')).toBe(false);
    expect(ehUrlEntregavel('https://127.0.0.1/api/webhooks/asaas')).toBe(false);
  });

  // O segredo viaja no header. Em http ele vaza no primeiro salto — e e o MESMO
  // segredo de todos os escritorios.
  it('recusa http', () => {
    expect(ehUrlEntregavel('http://app.balu.com.br/api/webhooks/asaas')).toBe(false);
  });

  it('recusa host sem ponto e lixo', () => {
    expect(ehUrlEntregavel('https://app/api/webhooks/asaas')).toBe(false);
    expect(ehUrlEntregavel('nao-e-url')).toBe(false);
    expect(ehUrlEntregavel('')).toBe(false);
  });
});

describe('segredoUtilizavel', () => {
  // Observado no sandbox: "O token deve ter pelo menos 32 caracteres."
  it('exige o minimo do Asaas', () => {
    expect(segredoUtilizavel(SEGREDO)).toBe(true);
    expect(segredoUtilizavel('x'.repeat(MIN_SEGREDO - 1))).toBe(false);
    expect(segredoUtilizavel('')).toBe(false);
    expect(segredoUtilizavel(undefined)).toBe(false);
  });
});

describe('montarPayloadWebhook', () => {
  const p = montarPayloadWebhook(URL_OK, SEGREDO, 'ops@balu.com.br');

  // O TESTE QUE MAIS IMPORTA DO ARQUIVO. Sem `authToken` o cadastro nao falha —
  // ele SUCEDE com um token que o Asaas inventa e nunca nos conta.
  it('leva o authToken', () => {
    expect(p.authToken).toBe(SEGREDO);
  });

  it('pede exatamente os eventos que traduzirEvento sabe ler', () => {
    expect([...p.events].sort()).toEqual([
      'PAYMENT_CONFIRMED', 'PAYMENT_CREATED', 'PAYMENT_OVERDUE',
      'PAYMENT_RECEIVED', 'PAYMENT_REFUNDED',
    ]);
  });

  // Todos obrigatorios no POST — levantados um a um contra o sandbox.
  it('traz todos os campos que o Asaas exige', () => {
    expect(p.name).toBeTruthy();
    expect(p.url).toBe(URL_OK);
    expect(p.email).toBe('ops@balu.com.br');
    expect(p.enabled).toBe(true);
    expect(p.interrupted).toBe(false);
    expect(p.sendType).toBe('SEQUENTIALLY');
  });
});

describe('diagnosticarWebhook', () => {
  it('acha o webhook pela url e diz ok', () => {
    expect(diagnosticarWebhook([webhook()], URL_OK)).toEqual({
      estado: 'ok', id: 'wh_1', penalizadas: 0,
    });
  });

  it('lista vazia (ou nula) e ausente', () => {
    expect(diagnosticarWebhook([], URL_OK)).toEqual({ estado: 'ausente' });
    expect(diagnosticarWebhook(null, URL_OK)).toEqual({ estado: 'ausente' });
  });

  // O webhook de OUTRO sistema na mesma subconta nao pode ser confundido com o
  // nosso — senao o diagnostico diz 'ok' e nunca cadastramos o nosso.
  it('ignora webhook de outra url', () => {
    expect(diagnosticarWebhook([webhook({ url: 'https://outro.com/hook' })], URL_OK))
      .toEqual({ estado: 'ausente' });
  });

  it('tolera barra final divergente', () => {
    expect(diagnosticarWebhook([webhook({ url: `${URL_OK}/` })], URL_OK).estado).toBe('ok');
  });

  // `interrupted` e o Asaas DESISTINDO de entregar. Nada chega, mesmo com o
  // resto todo certo — por isso vem antes de qualquer outra checagem.
  it('interrompido ganha de tudo', () => {
    expect(diagnosticarWebhook([webhook({ interrupted: true, enabled: false, events: [] })], URL_OK))
      .toMatchObject({ estado: 'interrompido', id: 'wh_1' });
  });

  it('desligado', () => {
    expect(diagnosticarWebhook([webhook({ enabled: false })], URL_OK))
      .toEqual({ estado: 'desligado', id: 'wh_1' });
  });

  it('eventos faltando aponta quais', () => {
    const d = diagnosticarWebhook([webhook({ events: ['PAYMENT_RECEIVED'] })], URL_OK);
    expect(d.estado).toBe('eventos_faltando');
    if (d.estado === 'eventos_faltando') {
      expect(d.faltando).toContain('PAYMENT_REFUNDED');
      expect(d.faltando).not.toContain('PAYMENT_RECEIVED');
    }
  });

  // Evento A MAIS nao e defeito: quem manda e a nossa lista estar contida.
  it('eventos extras nao viram problema', () => {
    expect(diagnosticarWebhook(
      [webhook({ events: [...EVENTOS_WEBHOOK, 'PAYMENT_DELETED'] })], URL_OK,
    ).estado).toBe('ok');
  });

  // hasAuthToken NAO e sinal de saude: o Asaas gera um token quando o cadastro
  // vai sem um. Este teste fixa que o diagnostico NAO tenta usar esse campo —
  // se um dia alguem "melhorar" o diagnostico olhando para ele, o webhook com
  // segredo errado continua passando por saudavel e o teste protege a leitura
  // honesta (o conserto e reescrever, nao diagnosticar).
  it('nao usa hasAuthToken para decidir', () => {
    expect(diagnosticarWebhook([webhook({ hasAuthToken: false })], URL_OK).estado).toBe('ok');
  });
});

describe('precisaReparo', () => {
  it('so os estados consertaveis por reescrita', () => {
    expect(precisaReparo({ estado: 'ok', id: 'w', penalizadas: 0 })).toBe(false);
    expect(precisaReparo({ estado: 'ausente' })).toBe(false);
    expect(precisaReparo({ estado: 'desligado', id: 'w' })).toBe(true);
    expect(precisaReparo({ estado: 'interrompido', id: 'w', penalizadas: 3 })).toBe(true);
    expect(precisaReparo({ estado: 'eventos_faltando', id: 'w', faltando: ['X'] })).toBe(true);
  });
});

describe('avisoDoDiagnostico', () => {
  it("'ok' nao gera aviso", () => {
    expect(avisoDoDiagnostico({ estado: 'ok', id: 'w', penalizadas: 0 })).toBeNull();
  });

  // O aviso nao pode dizer que a cobranca falha — ela nasce e e paga do mesmo
  // jeito. O que quebra e o app FICAR SABENDO. Se o texto exagerar, o
  // escritorio para de emitir por medo; se amenizar, ele ignora.
  it('todo estado ruim explica que o pagamento so aparece na conferencia', () => {
    const ruins: DiagnosticoWebhook[] = [
      { estado: 'ausente' },
      { estado: 'desligado', id: 'w' },
      { estado: 'interrompido', id: 'w', penalizadas: 2 },
      { estado: 'eventos_faltando', id: 'w', faltando: ['X'] },
    ];
    for (const d of ruins) {
      const t = avisoDoDiagnostico(d);
      expect(t).toBeTruthy();
      expect(t).toMatch(/confer[êe]ncia di[áa]ria/i);
    }
  });
});
