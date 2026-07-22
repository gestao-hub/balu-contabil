// src/app/api/contador/logo/route.ts
// Task 18: upload do logo do escritório (white-label). POST multipart/form-data
// com campo 'file'. Guard: membro de escritório APROVADO. Nunca confia em
// nome/content-type do arquivo — valida magic bytes e deriva ext/contentType
// do CONTEÚDO real antes de subir pro Storage.
import 'server-only';
import { NextResponse } from 'next/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { createServerClient } from '@/lib/supabase/server';
import { uploadLogoEscritorio, signedUrlBranding } from '@/lib/clients/supabase-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LOGO_BYTES = 1 * 1024 * 1024; // 1MB

type Sniffed = { ext: 'png' | 'jpg' | 'svg'; contentType: string };

/** Detecta o formato real pelos bytes iniciais — nunca pelo nome/content-type declarado. */
function sniffImage(buf: Buffer): Sniffed | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  // SVG é texto — procura a assinatura logo após espaços em branco/BOM iniciais.
  const head = buf.subarray(0, Math.min(buf.length, 512)).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml|<svg)/i.test(head)) {
    return { ext: 'svg', contentType: 'image/svg+xml' };
  }
  return null;
}

export async function POST(req: Request) {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) {
    return NextResponse.json({ ok: false, error: 'Sessão inválida.' }, { status: 401 });
  }
  if (!ctx.contabilidade) {
    return NextResponse.json({ ok: false, error: 'Você não faz parte de um escritório.' }, { status: 403 });
  }
  if (ctx.contabilidade.status !== 'aprovada') {
    return NextResponse.json({ ok: false, error: 'Escritório ainda não aprovado.' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Requisição inválida.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'Selecione um arquivo.' }, { status: 400 });
  }
  if (file.size > MAX_LOGO_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Arquivo maior que 1MB. Escolha uma imagem menor.' },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImage(buf);
  if (!sniffed) {
    return NextResponse.json(
      { ok: false, error: 'Formato inválido. Envie um PNG, JPG ou SVG.' },
      { status: 400 },
    );
  }

  const contabilidadeId = ctx.contabilidade.id;
  let path: string;
  try {
    ({ path } = await uploadLogoEscritorio(contabilidadeId, buf, sniffed.ext, sniffed.contentType));
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Falha ao enviar o arquivo.' },
      { status: 500 },
    );
  }

  // Cliente AUTENTICADO (não admin) — o GRANT de coluna em 0030 já cobre
  // logo_url para membros do escritório; RLS escopa pela própria contabilidade.
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('contabilidades')
    .update({ logo_url: path })
    .eq('id', contabilidadeId);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const url = await signedUrlBranding(path);
  return NextResponse.json({ ok: true, url });
}
