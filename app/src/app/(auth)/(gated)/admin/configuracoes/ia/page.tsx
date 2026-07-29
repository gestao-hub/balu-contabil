// Bloco 6A — configuração do provedor de IA (AdminBalu).
//
// A COLUNA CIFRADA NÃO SAI DAQUI. A página lê `chave_cifrada` só para decidir um
// booleano (`temChave`) e o descarta; o que atravessa para o Client Component é
// provedor, modelo, URL base e esse booleano. Mandar a coluna cifrada para a
// tela colocaria o segredo no HTML servido ao navegador — cifrado, mas ao
// alcance de qualquer extensão e de qualquer print.
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Provedor } from '@/lib/ai/provedores';
import ConfigIaForm from './ConfigIaForm';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAdminBaluPage();
  const sb = createAdminClient();

  const { data } = await sb
    .from('config_ia')
    .select('provedor, modelo, base_url, chave_cifrada')
    .eq('id', 1)
    .maybeSingle();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Provedor de IA</h1>
        <p className="text-sm text-muted-foreground">
          Quem redige os rascunhos das explicações de imposto. Trocar de provedor não exige
          deploy, e toda alteração aqui vai para o registro de auditoria.
        </p>
      </div>

      <ConfigIaForm
        inicial={{
          provedor: (data?.provedor as Provedor | null) ?? null,
          modelo: data?.modelo ?? '',
          baseUrl: data?.base_url ?? '',
          temChave: Boolean(data?.chave_cifrada),
        }}
      />
    </div>
  );
}
