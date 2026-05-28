// @custom — PR 1.3: proxy de download de XML/PDF da nota via Focus (não vaza o token).
import { createServerClient } from '@/lib/supabase/server';
import { focus, type FocusEnv } from '@/lib/clients/focus-nfe';
import { assertTipoDoc } from '@/lib/fiscal/notas-tipo';

export const runtime = 'nodejs';

const ENV: FocusEnv = 'hom';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const formato = new URL(req.url).searchParams.get('formato');
  if (formato !== 'xml' && formato !== 'pdf') {
    return new Response('formato inválido (use xml ou pdf)', { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('não autenticado', { status: 401 });
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return new Response('sem empresa', { status: 400 });

  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('tipo_documento, referencia')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (!nota) return new Response('nota não encontrada', { status: 404 });

  try {
    const tipo = assertTipoDoc(nota.tipo_documento as string);
    const ref = nota.referencia as string;
    if (formato === 'xml') {
      const r = tipo === 'NFe' ? await focus.baixarXmlNfe(ref, ENV)
        : tipo === 'NFCe' ? await focus.baixarXmlNfce(ref, ENV)
        : await focus.baixarXmlNfse(ref, ENV);
      return new Response(r.body, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="${ref}.xml"`,
        },
      });
    }
    const r = tipo === 'NFe' ? await focus.baixarDanfe(ref, ENV)
      : tipo === 'NFCe' ? await focus.baixarDanfeNfce(ref, ENV)
      : await focus.baixarDanfeNfse(ref, ENV);
    return new Response(Buffer.from(r.body), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${ref}.pdf"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'falha no download';
    return new Response(`Falha ao baixar da Focus: ${msg.slice(0, 200)}`, { status: 502 });
  }
}
