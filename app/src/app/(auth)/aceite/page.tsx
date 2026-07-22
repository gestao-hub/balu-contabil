// src/app/(auth)/aceite/page.tsx
// Gate de re-aceite (LGPD, Task 12): renderiza apenas quando há documento(s)
// publicado(s) pendente(s) de aceite pro usuário atual. Sem pendência (inclusive
// quando não há nada publicado ainda) -> redirect pra home, evitando página órfã.
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { documentosPendentes } from '@/lib/lgpd/pendencia-aceite';
import AceiteClient, { type DocumentoPendente } from './AceiteClient';

const TITULOS: Record<string, string> = {
  termos: 'Termos de Uso',
  privacidade: 'Política de Privacidade',
};

export default async function AceitePage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const pendentes = await documentosPendentes(user.id);
  if (pendentes.length === 0) redirect('/');

  // Última versão publicada de cada tipo pendente (mesmo critério do helper).
  const { data: docs } = await supabase
    .from('documento_versoes')
    .select('tipo, versao, conteudo_md, publicado_em')
    .not('publicado_em', 'is', null)
    .order('publicado_em', { ascending: false });

  const vigentes = new Map<string, { versao: string; conteudo_md: string }>();
  for (const d of docs ?? []) {
    if (!vigentes.has(d.tipo)) vigentes.set(d.tipo, { versao: d.versao, conteudo_md: d.conteudo_md });
  }

  const documentos: DocumentoPendente[] = pendentes
    .filter((tipo) => vigentes.has(tipo))
    .map((tipo) => ({
      tipo,
      titulo: TITULOS[tipo] ?? tipo,
      versao: vigentes.get(tipo)!.versao,
      conteudoMd: vigentes.get(tipo)!.conteudo_md,
    }));

  return <AceiteClient documentos={documentos} />;
}
