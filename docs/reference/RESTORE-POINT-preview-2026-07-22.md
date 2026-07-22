# Ponto de restauração — preview do Bloco A (2026-07-22)

Criado antes de subir o preview na Vercel para teste manual (conta luan-4913),
apontando para o Supabase de produção `llykzqnugdpojwnlontj`.

## Código
- Tag git: **`pre-preview-bloco-a`** em `f1c3f21` (branch `feat/bloco-a-multitenant`).
- Reverter código: `git reset --hard pre-preview-bloco-a` (ou voltar pra `main`).

## Banco — estado no cutoff `2026-07-22T17:35:18.539Z`
Tabelas do Bloco A **vazias** (0 contabilidades / membros / convites / honorários v2 /
companies vinculadas). Logo, tudo criado durante o teste é novo.

Baseline (o que já existia — NÃO apagar):
- companies: `3f7370a5-bfdc-4d3b-b59d-9165967d28c8`, `c070a7ec-31c1-45e0-87ee-1aee9a7a3ae4`
- auth.users: `233219e7-3e40-42af-be00-1634ee17553c`, `7e584022-23e1-410c-acf2-a712d059c513`

## Reverter o banco ao pré-teste (Bloco A)
Rodar `scratchpad/reverter-preview.sql` (ou colar no SQL Editor). Ele:
1. apaga honorários v2 (contabilidade_id not null);
2. desvincula companies (contabilidade_id = null);
3. apaga contabilidades (cascata em membros/convites);
4. (opcional/comentado) apaga companies e usuários criados após o cutoff — revise
   antes, para não remover cadastros legítimos feitos no meio do teste.

## Rede de segurança final
Supabase tem PITR/backups no projeto (Dashboard → Database → Backups). Para um
rollback total do banco a um instante, usar o Point-in-Time Recovery do painel —
é o único caminho que desfaz também escritas em tabelas legadas (notas, guias etc.).
