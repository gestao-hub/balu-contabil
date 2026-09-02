// Roda a varredura responsiva (tests/responsivo.spec.ts) com a trava de
// ambiente satisfeita, SEM passar segredo por linha de comando.
//
// POR QUE UM RUNNER. `tests/guarda-ambiente.ts` exige E2E_SUPABASE_URL +
// as duas chaves, e — quando o alvo É o banco da aplicação — o opt-in por
// extenso `E2E_TENANT_SINTETICO`. Exportar isso na linha de comando deixaria a
// service_role visível na lista de processos. Aqui os valores saem do
// `.env.local` e vão direto no `env` do processo filho.
//
// O QUE A SUÍTE FAZ EM PRODUÇÃO (decisão do usuário em 01/09/2026, registrada
// em guarda-ambiente.ts): cria os PRÓPRIOS atores — 3 usuários
// `resp-*@balu-test.local`, 1 empresa, 1 escritório — varre as rotas e apaga
// tudo no `afterAll`. Não escolhe vítima e não toca em linha preexistente.
//
// Uso (a partir de app/, com o servidor já no ar em :3000):
//   node scripts/rodar-e2e-responsivo.mjs [--todos]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);

const faltando = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  .filter((k) => !env[k]);
if (faltando.length) {
  console.error(`\nfaltam no .env.local: ${faltando.join(', ')}\n`);
  process.exit(1);
}

const alvo = process.argv.includes('--todos') ? [] : ['tests/responsivo.spec.ts'];

console.log('\nalvo E2E   :', env.NEXT_PUBLIC_SUPABASE_URL);
console.log('opt-in     : tenant sintético EM PRODUÇÃO (cria e apaga os próprios atores)');
console.log('specs      :', alvo.length ? alvo.join(' ') : '(todas)');
console.log('');

const filho = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', ...alvo, '--reporter=line'],
  {
    stdio: 'inherit',
    // `shell: true` e obrigatorio no Windows para executar `npx.cmd` (spawn
    // direto de .cmd da EINVAL). Os segredos continuam FORA do argv: vao pelo
    // `env` abaixo, nao na linha de comando.
    shell: true,
    env: {
      ...process.env,
      ...env,
      E2E_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
      E2E_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      E2E_SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      E2E_TENANT_SINTETICO: 'sim-eu-autorizo-tenant-sintetico-em-producao',
    },
  },
);
filho.on('exit', (c) => process.exit(c ?? 1));
