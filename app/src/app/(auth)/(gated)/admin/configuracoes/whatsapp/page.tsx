// 0101 — canal de WhatsApp da plataforma (AdminBalu).
//
// A COLUNA CIFRADA NÃO SAI DAQUI. A página lê o estado do canal e descarta o
// `token_cifrado`; o que atravessa para o Client Component é status, número e
// data. Mandar a coluna cifrada para a tela colocaria o segredo no HTML servido
// ao navegador — cifrado, mas ao alcance de qualquer extensão e de qualquer
// print.
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { lerConfigWhatsapp } from '@/lib/uazapi/config-plataforma';
import WhatsappPlataformaClient from './WhatsappPlataformaClient';
import AdminTokenForm from './AdminTokenForm';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAdminBaluPage();
  const r = await lerConfigWhatsapp();

  const cabecalho = (
    <div>
      <h1 className="mb-1 text-xl font-semibold">WhatsApp da plataforma</h1>
      <p className="text-sm text-muted-foreground">
        O número oficial do Balu, que atende as empresas sem escritório contábil vinculado.
        Conectar aqui não exige deploy, e toda alteração vai para o registro de auditoria.
      </p>
    </div>
  );

  // LEITURA QUE FALHOU NÃO PODE VIRAR "NUNCA CONECTADO" — mesma decisão das
  // telas de IA e da Focus. Desenhar a tela de conexão diria ao admin que o
  // canal caiu quando ele pode estar no ar, e o pior desfecho não é a mensagem
  // errada: é ele reconectar por cima de uma instância que está funcionando.
  if (!r.ok) {
    return (
      <div className="space-y-6 p-6">
        {cabecalho}
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível ler a configuração.</p>
          <p className="mt-1 text-muted-foreground">
            A tela de conexão fica escondida de propósito: o estado do canal é desconhecido
            agora, e reconectar por cima poderia derrubar um número que está atendendo.
            Recarregue a página; se persistir, o motivo está no log do servidor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {cabecalho}
      {/* O ADMIN TOKEN VEM PRIMEIRO de propósito: sem ele nenhuma instância é
          criada, e o QR abaixo falharia com uma mensagem que a pessoa não tem
          como consertar sem sair da tela. */}
      <AdminTokenForm configurado={Boolean(r.linha?.admin_token_cifrado)} />

      <WhatsappPlataformaClient
        status={r.linha?.status ?? 'desconectado'}
        numero={r.linha?.numero ?? null}
        conectadoEm={r.linha?.conectado_em ?? null}
      />
    </div>
  );
}
