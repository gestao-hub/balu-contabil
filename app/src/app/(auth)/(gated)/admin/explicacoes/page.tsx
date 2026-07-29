// Bloco 6A — catálogo de explicações (AdminBalu).
//
// DUAS LISTAS QUE VIRAM UMA. As explicações que já existem, e as situações que a
// tela de algum cliente pediu e não encontrou (`explicacoes_faltando`). As
// segundas vêm primeiro e ordenadas por quantas vezes foram pedidas: é o que faz
// o catálogo crescer por demanda real em vez de adivinhação — mesmo princípio do
// contador de boletos órfãos do 4B.
//
// LÊ PELO ADMIN CLIENT de propósito: a policy de `explicacoes_fiscais` só deixa
// ver o que está `aprovado`, e esta é justamente a tela que precisa ver o
// RASCUNHO. Pela sessão do usuário, o admin não enxergaria o que veio revisar.
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { situacaoDaChave, rotuloDaSituacao } from '@/lib/fiscal/situacao-fiscal';
import { marcadoresDaChave } from '@/lib/explicacoes/marcadores';
import CatalogoExplicacoes, { type ItemCatalogo } from './CatalogoExplicacoes';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAdminBaluPage();
  const sb = createAdminClient();

  const [catalogo, faltando, config] = await Promise.all([
    sb.from('explicacoes_fiscais')
      .select('chave, texto, status, gerado_por, aprovado_em')
      .order('chave'),
    sb.from('explicacoes_faltando')
      .select('chave, vistas')
      .order('vistas', { ascending: false }),
    sb.from('config_ia').select('provedor, chave_cifrada').eq('id', 1).maybeSingle(),
  ]);

  const cabecalho = (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Explicações de imposto</h1>
      <p className="text-sm text-muted-foreground">
        Um texto por <b>situação fiscal</b> — nunca por cliente. Nenhum texto daqui aparece
        para ninguém antes de ser aprovado nesta tela.
      </p>
    </div>
  );

  // Erro de leitura não pode virar "catálogo vazio": a tela ofereceria escrever
  // do zero o que já existe, e o admin poderia aprovar por cima sem saber.
  const erro = catalogo.error ?? faltando.error;
  if (erro) {
    console.error('[6a] catalogo leitura falhou na pagina:', erro.message);
    return (
      <div className="space-y-6 p-6">
        {cabecalho}
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível ler o catálogo.</p>
          <p className="mt-1 text-muted-foreground">
            A lista fica escondida de propósito: mostrá-la vazia faria parecer que não há
            nada aprovado, e escrever por cima do que já existe seria fácil demais.
            Recarregue a página; se persistir, o motivo está no log do servidor.
          </p>
        </div>
      </div>
    );
  }

  const linhas = catalogo.data ?? [];
  const jaNoCatalogo = new Set(linhas.map((l) => l.chave));

  const doCatalogo: ItemCatalogo[] = linhas.map((l) => montarItem({
    chave: l.chave,
    texto: l.texto ?? '',
    status: l.status === 'aprovado' ? 'aprovado' : 'rascunho',
    geradoPor: l.gerado_por,
    aprovadoEm: l.aprovado_em,
    vistas: 0,
  }));

  // Só as que ainda não têm linha: uma situação com rascunho já aparece acima,
  // e listá-la duas vezes daria dois textareas para o mesmo texto.
  const semTexto: ItemCatalogo[] = (faltando.data ?? [])
    .filter((f) => !jaNoCatalogo.has(f.chave))
    .map((f) => montarItem({
      chave: f.chave, texto: '', status: 'ausente',
      geradoPor: null, aprovadoEm: null, vistas: Number(f.vistas ?? 0),
    }));

  // As pedidas e ausentes primeiro: é o trabalho que existe.
  const itens = [...semTexto, ...doCatalogo];

  const temProvedorIa = Boolean(config.data?.provedor && config.data?.chave_cifrada);

  return (
    <div className="space-y-6 p-6">
      {cabecalho}

      {!temProvedorIa && (
        <p className="rounded-md border border-border bg-surface p-3 text-xs text-muted-foreground">
          Nenhum provedor de IA configurado — o botão <b>Gerar com IA</b> fica desligado.
          Escrever o texto à mão e aprovar funciona do mesmo jeito: a IA só redige o
          rascunho, ela nunca participa de exibir a explicação.
        </p>
      )}

      <CatalogoExplicacoes itens={itens} temProvedorIa={temProvedorIa} />
    </div>
  );
}

/** Deriva rótulo e marcadores da chave. Situação que o parse não reconhece ainda
 *  é listada — ela existe no banco, e escondê-la deixaria uma linha órfã que
 *  ninguém veria para corrigir. */
function montarItem(base: Omit<ItemCatalogo, 'rotulo' | 'marcadores'>): ItemCatalogo {
  const s = situacaoDaChave(base.chave);
  return {
    ...base,
    rotulo: s ? rotuloDaSituacao(s) : `situação não reconhecida (${base.chave})`,
    marcadores: marcadoresDaChave(base.chave),
  };
}
