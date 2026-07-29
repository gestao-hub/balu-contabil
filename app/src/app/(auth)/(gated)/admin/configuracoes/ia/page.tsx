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

  const { data, error } = await sb
    .from('config_ia')
    .select('provedor, modelo, base_url, chave_cifrada')
    .eq('id', 1)
    .maybeSingle();

  const cabecalho = (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Provedor de IA</h1>
      <p className="text-sm text-muted-foreground">
        Quem redige os rascunhos das explicações de imposto. Trocar de provedor não exige
        deploy, e toda alteração aqui vai para o registro de auditoria.
      </p>
    </div>
  );

  // LEITURA QUE FALHOU NÃO PODE VIRAR "NUNCA CONFIGURADO". Descartar o `error` e
  // seguir com `data` nulo desenharia o formulário vazio, com "Testar conexão"
  // apagado e o aviso "Sem chave guardada" — dizendo ao admin que o segredo
  // sumiu quando ele está lá. O gatilho mais provável é o que a própria 0056
  // avisa na última linha: cache de schema do PostgREST velho logo depois da
  // migration. E o pior desfecho não é a mensagem errada: é o admin colar a
  // chave de novo em cima de um estado que ele não está enxergando.
  if (error) {
    console.error('[6a] config_ia leitura falhou na pagina:', error.message);
    return (
      <div className="space-y-6 p-6">
        {cabecalho}
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível ler a configuração.</p>
          <p className="mt-1 text-muted-foreground">
            O formulário fica escondido de propósito: o que está gravado é desconhecido agora, e
            salvar por cima poderia trocar uma configuração que está funcionando. Recarregue a
            página; se persistir, o motivo está no log do servidor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {cabecalho}

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
