// 0094/0095 — token de revenda da Focus NFe (AdminBalu).
//
// A COLUNA CIFRADA NÃO SAI DAQUI. A página lê `token_revenda_cifrado` só para
// decidir um booleano e o descarta; o que atravessa para o Client Component é
// apenas "tem ou não tem". Mandar a coluna cifrada para a tela colocaria o
// segredo no HTML servido ao navegador — cifrado, mas ao alcance de qualquer
// extensão e de qualquer print.
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import ConfigFocusForm from './ConfigFocusForm';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAdminBaluPage();
  const sb = createAdminClient();

  const { data, error } = await sb
    .from('config_focus')
    .select('token_revenda_cifrado, atualizado_em')
    .eq('id', 1)
    .maybeSingle();

  const cabecalho = (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Focus NFe</h1>
      <p className="text-sm text-muted-foreground">
        O token com que a plataforma cadastra empresa, atualiza cadastro e envia
        certificado em nome dos clientes. Trocar aqui não exige deploy, e toda alteração
        vai para o registro de auditoria.
      </p>
    </div>
  );

  // LEITURA QUE FALHOU NÃO PODE VIRAR "NUNCA CONFIGURADO" — mesma decisão da
  // tela de IA. Desenhar o formulário vazio diria ao admin que o token sumiu
  // quando ele está lá, e o pior desfecho não é a mensagem errada: é ele colar
  // outro token por cima de um estado que não está enxergando.
  if (error) {
    console.error('[0095] config_focus leitura falhou na pagina:', error.message);
    return (
      <div className="space-y-6 p-6">
        {cabecalho}
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível ler a configuração.</p>
          <p className="mt-1 text-muted-foreground">
            O formulário fica escondido de propósito: o que está gravado é desconhecido agora, e
            salvar por cima poderia trocar uma credencial que está funcionando. Recarregue a
            página; se persistir, o motivo está no log do servidor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {cabecalho}

      <ConfigFocusForm
        inicial={{ temToken: Boolean(data?.token_revenda_cifrado) }}
      />
    </div>
  );
}
