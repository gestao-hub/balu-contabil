'use client';
// Conexão do canal do ESCRITÓRIO.
//
// QR CODE É O CAMINHO PRINCIPAL desde 24/08/2026. Antes a tela pedia o número
// digitado e devolvia um código de 8 dígitos para teclar no celular; agora ela
// abre, provisiona a instância sozinha e mostra o QR — escanear é tudo.
//
// A MECÂNICA MORA EM `components/ConexaoWhatsapp`, compartilhada com a tela do
// canal da plataforma (`/admin/configuracoes/whatsapp`): as duas telas têm o
// mesmo ciclo de vida de QR, e duplicá-lo era garantir que uma das duas
// ficasse para trás no dia em que o contrato da uazapi mudasse. O que fica
// aqui é o que é DESTE canal: quem atende, e o que acontece com quem escreve.
import ConexaoWhatsapp from '@/components/ConexaoWhatsapp';
import {
  conectarWhatsappAction, conectarPorCodigoAction, statusWhatsappAction, desconectarWhatsappAction,
} from './actions';

type Props = { status: string; numero: string | null; conectadoEm: string | null };

export default function WhatsappClient({ status, numero, conectadoEm }: Props) {
  return (
    <ConexaoWhatsapp
      status={status}
      numero={numero}
      conectadoEm={conectadoEm}
      aoConectar={conectarWhatsappAction}
      aoConectarPorCodigo={conectarPorCodigoAction}
      aoConsultar={statusWhatsappAction}
      aoDesconectar={desconectarWhatsappAction}
      textoConectado="Seus clientes já podem escrever para ele."
      instrucoes={
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Use um <strong>número dedicado ao escritório</strong>, não o celular pessoal de
            alguém: toda conversa que chegar nele passa a ser atendida pelo assistente.
          </li>
          <li>
            No celular que vai atender, abra <em>WhatsApp → Configurações → Dispositivos
            conectados → Conectar um dispositivo</em> e aponte a câmera para o código abaixo.
          </li>
        </ul>
      }
    />
  );
}
