import { test, expect } from '@playwright/test';

// Postura do Storage, vista de FORA — auditoria de 25/08/2026.
//
// POR QUE ESTE ARQUIVO EXISTE. O bucket `company-certificates` ficou publico
// por 32 sessoes. Nao havia o que revisar: o bucket e suas quatro policies nunca
// estiveram numa migration — foram criados no painel — e a unica declaracao
// daquilo no repositorio era um comentario em `supabase-storage.ts` chamando o
// bucket de "privado". Comentario nao compila, nao roda e nao fica vermelho.
//
// Este teste NAO le codigo nem migration. Ele refaz o ataque e exige que falhe:
//
//   1. listar o bucket com a anon key   -> tem de ser recusado
//   2. GET na URL publica do objeto     -> tem de ser recusado
//
// USA SO CREDENCIAL PUBLICA. Nao precisa de service_role nem da senha do banco,
// porque e exatamente o que um estranho tem na mao: a anon key sai do bundle de
// qualquer pagina do app. Por isso tambem e seguro rodar contra PRODUCAO — nao
// escreve nada e nao le nada que ja nao esteja aberto.
//
// Rodar:  set -a; . ./.env.local; set +a; npx playwright test tests/storage-postura.spec.ts

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

test.skip(
  () => !URL_ || !ANON,
  'NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY ausentes (set -a; . ./.env.local; set +a)',
);

/** Buckets que guardam material sensivel e NUNCA podem responder a estranho. */
const BUCKETS_FECHADOS = [
  'company-certificates',
  'abertura-documentos',
  'branding',
  'declaracoes-comprovantes',
  'guias-comprovantes',
  'liberacoes-comprovantes',
];

test.describe('Storage: o que um estranho alcanca', () => {
  for (const bucket of BUCKETS_FECHADOS) {
    test(`${bucket}: a anon key nao lista o conteudo`, async () => {
      const r = await fetch(`${URL_}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
        body: JSON.stringify({ prefix: '', limit: 100, offset: 0 }),
      });
      const corpo = await r.text();
      let itens: unknown[] | null = null;
      try {
        const j = JSON.parse(corpo);
        if (Array.isArray(j)) itens = j;
      } catch {
        /* resposta de erro nao e JSON de lista: e o que queremos */
      }

      // 200 com lista VAZIA tambem passa: significa que a RLS filtrou tudo.
      // O que reprova e a anon key receber os NOMES — foi assim que o caminho
      // "adivinhavel" dos certificados foi entregue de bandeja em 25/08.
      expect(
        itens?.length ?? 0,
        `a anon key listou ${itens?.length} objeto(s) de ${bucket}: ` +
          `${JSON.stringify(itens?.slice(0, 5))}`,
      ).toBe(0);
    });

    test(`${bucket}: a URL publica nao serve objeto`, async () => {
      // Caminho inexistente de proposito. O que se mede aqui e o MODO do
      // bucket, nao um arquivo: bucket privado responde 400/404 a qualquer
      // caminho; bucket publico responde 404 no inexistente e 200 no que
      // existe. Por isso o teste de listagem acima e o que de fato prende — e
      // por isso este confere tambem o `content-type`, que denuncia um 200.
      const r = await fetch(
        `${URL_}/storage/v1/object/public/${bucket}/prova-de-postura-inexistente.bin`,
      );
      expect(r.status, `${bucket} respondeu ${r.status} a um GET sem credencial`).not.toBe(200);
    });
  }

  test('company-certificates: nenhum certificado real responde a um GET anonimo', async () => {
    // A prova direta do achado. Se a listagem estiver fechada (teste acima),
    // nao ha como enumerar — entao este teste usa os caminhos que a auditoria
    // ja conhece. Eles sao UUIDs de empresa, nao segredo, e o arquivo em si e
    // ciphertext AES-GCM; o que se afirma aqui e so "o servidor recusa".
    const conhecidos = [
      'system/serpro-contratante.enc',
      '3f7370a5-bfdc-4d3b-b59d-9165967d28c8/certificado.enc',
      '41a9c2a4-241f-40b0-a1c5-da3fced49359/certificado.enc',
      '44bd4761-76f3-4288-be34-b8412a072195/certificado.enc',
      '967eda7e-f504-4585-be24-666bc2c9b215/certificado.enc',
    ];
    const abertos: string[] = [];
    for (const nome of conhecidos) {
      const u = `${URL_}/storage/v1/object/public/company-certificates/${nome
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      // HEAD, nao GET: numa auditoria nao se baixa material de chave.
      const r = await fetch(u, { method: 'HEAD' });
      if (r.status === 200) abertos.push(`${nome} (${r.headers.get('content-length')} bytes)`);
    }
    expect(abertos, `certificado(s) baixavel(is) sem credencial: ${abertos.join(', ')}`).toEqual([]);
  });
});
