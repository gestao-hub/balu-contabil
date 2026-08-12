// Smoke do atendimento por WhatsApp contra o provedor de IA REAL.
//
// Existe porque o teste ao vivo de 12/08 chegou até o fim do fluxo (webhook
// autenticado, telefone reconhecido, mensagem entregue) e ainda assim o
// cliente recebeu o texto de fallback: "Não consegui responder agora — o
// contador vai retornar em breve".
//
// Nenhum teste de unidade pega isso, porque o que falha é o CONTRATO com o
// modelo: ele precisa devolver `{"resposta": "...", "resolvido": bool}`, e um
// modelo que responde em prosa derruba o atendimento inteiro para o fallback
// sem erro nenhum aparecer.
//
// Pulado por padrão. Para rodar (a partir de `app/`):
//   SMOKE_IA=1 npx vitest run src/lib/atendimento/ia.smoke.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { createRequire } from 'node:module';
import { montarPromptAtendimento } from './prompt';
import { gerarTexto } from '@/lib/ai/cliente';
import type { ConfigProvedor } from '@/lib/ai/tipos';

const semSmoke = process.env.SMOKE_IA !== '1';

// `pg` não é dependência declarada (vem de carona e sem tipos) — `import`
// quebraria o typecheck de todos por causa de um smoke sob demanda.
type PgClient = {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: Record<string, string | null>[] }>;
  end(): Promise<void>;
};
const pg = createRequire(import.meta.url)('pg') as {
  Client: new (cfg: Record<string, unknown>) => PgClient;
};

function env(): Record<string, string> {
  return Object.fromEntries(
    readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
  );
}

async function configDoBanco(): Promise<ConfigProvedor> {
  const e = env();
  const ref = e.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)![1];
  const c = new pg.Client({
    host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres',
    password: e.SUPABASE_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query('SELECT provedor, modelo, base_url, chave_cifrada FROM public.config_ia WHERE id = 1');
  await c.end();
  const row = r.rows[0];
  const k = Buffer.from(e.CERT_ENC_KEY, 'base64');
  const b = Buffer.from(String(row.chave_cifrada).slice('enc:v1:'.length), 'base64');
  const d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return {
    provedor: row.provedor as never, modelo: row.modelo as string, base_url: row.base_url,
    chave: Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'),
  };
}

/** A mesma checagem que o webhook faz antes de usar a resposta. */
function respostaValida(bruto: string): { resposta: string; resolvido: boolean } | null {
  const semCerca = bruto.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? bruto;
  try {
    const j = JSON.parse(semCerca) as Record<string, unknown>;
    if (typeof j.resposta === 'string' && j.resposta.trim() && typeof j.resolvido === 'boolean') {
      return { resposta: j.resposta, resolvido: j.resolvido };
    }
  } catch { /* prosa em vez de JSON */ }
  return null;
}

describe.skipIf(semSmoke)('atendimento × provedor real', () => {
  it('devolve {resposta, resolvido} — o contrato que o webhook exige', async () => {
    const cfg = await configDoBanco();
    const prompt = montarPromptAtendimento({
      pergunta: 'Preciso do DAS deste mês',
      situacaoFiscalTexto: 'MEI, DAS de agosto/2026 no valor de R$ 76,90, vence em 20/08/2026, ainda não pago.',
      primeiraInteracao: true,
    });

    const bruto = await gerarTexto(cfg, prompt);
    const lido = respostaValida(bruto);

    // Falhar aqui significa: em produção, TODO cliente recebe o texto de
    // fallback e o atendimento é escalado para o contador — exatamente o que
    // aconteceu no teste ao vivo de 12/08 com o modelo gratuito.
    if (!lido) console.error(`[smoke] modelo ${cfg.modelo} respondeu fora do contrato:\n`, bruto.slice(0, 500));
    expect(lido).not.toBeNull();
    expect(lido!.resposta.length).toBeGreaterThan(10);
  }, 90_000);

  it('usa a memória da conversa em vez de pedir tudo de novo', async () => {
    // Sem memória, a segunda pergunta ("e quando vence?") vira um pedido de
    // esclarecimento — o cliente tem de repetir do que está falando.
    const cfg = await configDoBanco();
    const bruto = await gerarTexto(cfg, montarPromptAtendimento({
      pergunta: 'e quando vence?',
      situacaoFiscalTexto: 'MEI, DAS de agosto/2026 no valor de R$ 76,90, vence em 20/08/2026, ainda não pago.',
      historico: [{ pergunta: 'Quanto é o meu DAS?', resposta: 'O seu DAS deste mês é R$ 76,90.' }],
    }));
    const lido = respostaValida(bruto);
    expect(lido).not.toBeNull();
    expect(lido!.resposta).toMatch(/20\/08|20 de agosto/i);
  }, 90_000);

  it('responde com o apoio da base jurídica sem virar citação de lei', async () => {
    // O material entra como contexto interno; a resposta ao cliente continua
    // em português simples, sem citar norma (DL 9.295/46).
    const cfg = await configDoBanco();
    const bruto = await gerarTexto(cfg, montarPromptAtendimento({
      pergunta: 'o que acontece se eu passar do limite do MEI?',
      situacaoFiscalTexto: 'MEI, faturamento acumulado de R$ 70.000 no ano.',
      contextoJuridico: [{
        titulo: 'Limite de faturamento do MEI',
        texto: 'O MEI que exceder o limite anual de receita bruta deve recolher a diferença e pode ser desenquadrado, passando a Microempresa no Simples Nacional.',
      }],
    }));
    const lido = respostaValida(bruto);
    expect(lido).not.toBeNull();
    expect(lido!.resposta).not.toMatch(/(lei|artigo|art\.|LC\s*123|resolu[çc][ãa]o)/i);
  }, 90_000);

  it('duvida GERAL sem dado fiscal nenhum: responde em vez de escalar', async () => {
    // O caso que o usuario pediu: "mesmo que a IA nao consiga encontrar meus
    // dados fiscais, ela precisa responder questoes simples como funcionam
    // impostos". Antes disto, `situacaoFiscalTexto: null` levava o modelo a
    // dizer que ia encaminhar para o contador.
    const cfg = await configDoBanco();
    const bruto = await gerarTexto(cfg, montarPromptAtendimento({
      pergunta: 'o que e IPI?',
      situacaoFiscalTexto: null,
      tipoPergunta: 'geral',
      contextoJuridico: [{
        titulo: 'IPI — Imposto sobre Produtos Industrializados',
        texto: 'Tributo federal que incide sobre produtos industrializados, cobrado na saida do estabelecimento industrial ou no desembaraco aduaneiro.',
      }],
    }));
    const lido = respostaValida(bruto);
    expect(lido).not.toBeNull();
    expect(lido!.resposta).toMatch(/produto|industrializ|federal/i);
    expect(lido!.resposta.toLowerCase()).not.toMatch(/encaminhar para o contador|vou encaminhar/);
    expect(lido!.resolvido).toBe(true);
  }, 90_000);

  it('pergunta SOBRE A EMPRESA sem dado fiscal: encaminha, nao inventa', async () => {
    const cfg = await configDoBanco();
    const bruto = await gerarTexto(cfg, montarPromptAtendimento({
      pergunta: 'quanto e o meu DAS deste mes?',
      situacaoFiscalTexto: null,
      tipoPergunta: 'especifica',
    }));
    const lido = respostaValida(bruto);
    expect(lido).not.toBeNull();
    // Nao pode inventar um valor que ninguem calculou.
    expect(lido!.resposta).not.toMatch(/R\$\s*\d/);
    expect(lido!.resolvido).toBe(false);
  }, 90_000);

  it('não cita lei nem artigo na resposta ao cliente', async () => {
    // Fronteira do DL 9.295/46: quem orienta sobre tributo profissionalmente é
    // contador licenciado. O guard-rail vale para o texto que chega ao cliente.
    const cfg = await configDoBanco();
    const bruto = await gerarTexto(cfg, montarPromptAtendimento({
      pergunta: 'Por que eu pago esse valor de imposto?',
      situacaoFiscalTexto: 'MEI, DAS mensal de R$ 76,90.',
      primeiraInteracao: false,
    }));
    const lido = respostaValida(bruto);
    expect(lido).not.toBeNull();
    expect(lido!.resposta).not.toMatch(/\b(lei|artigo|art\.|LC\s*123|resolu[çc][ãa]o)\b/i);
  }, 90_000);
});
