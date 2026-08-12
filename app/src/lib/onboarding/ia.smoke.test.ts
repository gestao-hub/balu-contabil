// Smoke do onboarding conversacional contra o provedor de IA REAL.
//
// Os testes de unidade provam a máquina, a redação e o parser — mas nenhum
// deles prova o que só o provedor pode dizer: se ESTE modelo, com ESTE prompt,
// devolve o JSON no formato que `lerRespostaModelo` aceita. Sem isso, o
// assistente cairia sempre no texto padrão em produção e ninguém notaria: a
// conversa continuaria funcionando, só que sem IA nenhuma.
//
// Pulado por padrão. Para rodar (a partir de `app/`):
//   SMOKE_IA=1 npx vitest run src/lib/onboarding/ia.smoke.test.ts
//
// Consome tokens de verdade: uma chamada curta por caso.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { createRequire } from 'node:module';
import { montarPromptOnboarding, lerRespostaModelo } from './prompt';
import { gerarTexto } from '@/lib/ai/cliente';
import type { ConfigProvedor } from '@/lib/ai/tipos';

const semSmoke = process.env.SMOKE_IA !== '1';

// `pg` NÃO é dependência declarada deste app — está no node_modules de carona
// e sem tipos. `import pg from 'pg'` quebra `npm run typecheck` para todo
// mundo (TS7016) por causa de um smoke que só roda sob demanda, com
// SMOKE_IA=1. Carregado por `require` e tipado aqui com a forma mínima que
// este arquivo usa: o gate volta a passar sem instalar nada.
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

function decifrar(v: string, chaveB64: string): string {
  const k = Buffer.from(chaveB64, 'base64');
  const b = Buffer.from(v.slice('enc:v1:'.length), 'base64');
  const d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
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
  // Sem linha em `config_ia` não há o que exercitar — e o erro precisa dizer
  // isso, em vez de estourar num `undefined.provedor` três linhas abaixo.
  const row = r.rows[0];
  if (!row?.provedor || !row.modelo || !row.chave_cifrada) {
    throw new Error('[smoke] config_ia sem provedor/modelo/chave — configure a IA no admin antes de rodar.');
  }
  return {
    provedor: row.provedor as ConfigProvedor['provedor'],
    modelo: row.modelo,
    base_url: row.base_url ?? '',
    chave: decifrar(row.chave_cifrada, e.CERT_ENC_KEY),
  };
}

describe.skipIf(semSmoke)('onboarding × provedor real', () => {
  it('devolve JSON no formato que o app aceita', async () => {
    const cfg = await configDoBanco();
    const prompt = montarPromptOnboarding({
      historico: [], campoPendente: 'intencao', intencaoAtual: 'indefinido',
    });

    const bruto = await gerarTexto(cfg, prompt);
    const lido = lerRespostaModelo(bruto);

    // Se falhar aqui, o assistente cai no texto padrão em produção — funciona,
    // mas sem IA. O log abaixo é o que diz o porquê.
    if (!lido) console.error('[smoke] resposta crua do modelo:', bruto.slice(0, 400));
    expect(lido).not.toBeNull();
    expect(lido!.pergunta.length).toBeGreaterThan(5);
  }, 90_000);

  it('lê a intenção de quem se apresenta como contador', async () => {
    const cfg = await configDoBanco();
    const prompt = montarPromptOnboarding({
      historico: [{ de: 'usuario', texto: 'sou contador e tenho um escritório com uns 30 clientes' }],
      campoPendente: 'intencao', intencaoAtual: 'indefinido',
    });

    const lido = lerRespostaModelo(await gerarTexto(cfg, prompt));
    expect(lido?.intencao).toBe('contador');
  }, 90_000);

  it('não repete o dado mascarado nem pede para reenviar', async () => {
    // O modelo vê ⟨CNPJ⟩ no lugar do número. Se ele responder "não entendi
    // esse CNPJ, pode repetir?", a conversa entra em loop — e o usuário não
    // tem como sair, porque reenviar o número gera a mesma máscara.
    const cfg = await configDoBanco();
    const prompt = montarPromptOnboarding({
      historico: [{ de: 'usuario', texto: 'já tenho empresa, meu cnpj é ⟨CNPJ⟩' }],
      campoPendente: 'crc', intencaoAtual: 'empresa_existente',
    });

    const lido = lerRespostaModelo(await gerarTexto(cfg, prompt));
    expect(lido).not.toBeNull();
    expect(lido!.pergunta).not.toMatch(/⟨CNPJ⟩/);
    expect(lido!.pergunta.toLowerCase()).not.toMatch(/repet(ir|e)|reenvi|n[ãa]o entendi o cnpj/);
  }, 90_000);
});
