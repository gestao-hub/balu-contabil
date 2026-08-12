// Bloco 7, Task 3 — endpoint da verificacao de dominio proprio (§2.2 da spec).
//
// Publico e sem parametro de proposito: a chave e o HOST da requisicao. O
// servidor da Balu chama `GET https://<host-do-escritorio>/api/dominio/
// verificacao` de fora e compara o token que voltar. Se confere, ficou
// provado de uma vez que o DNS aponta pra ca, que o TLS esta de pe e que e
// este app que responde naquele host.
//
// Aceitar um `?host=` transformaria isto num oraculo que responde sobre
// QUALQUER dominio a partir de QUALQUER host — inclusive do dominio
// principal. Nao aceita.
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';
import { hostDaRequisicao } from '@/lib/dominios/host';

// Sem cache: verificar duas vezes tem que consultar duas vezes, e o token
// muda quando o escritorio troca de dominio.
export const dynamic = 'force-dynamic';

export async function GET() {
  const host = hostDaRequisicao(await headers());
  if (!host) return NextResponse.json({ erro: 'host ausente' }, { status: 400 });

  // Cliente da sessao (sem sessao aqui = papel `anon`), nao o admin: a RPC
  // e SECURITY DEFINER com retorno de uma coluna so, entao nao ha motivo pra
  // service_role encostar neste caminho publico.
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('dominio_token_por_host', { p_host: host });

  if (error) {
    console.error('[dominio/verificacao] rpc', error.message);
    return NextResponse.json({ erro: 'indisponivel' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ erro: 'dominio nao cadastrado' }, { status: 404 });

  return NextResponse.json({ token: data, host }, { headers: { 'cache-control': 'no-store' } });
}
