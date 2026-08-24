'use client';
// Conexão do canal DA PLATAFORMA — o número oficial do Balu.
//
// Mesma mecânica da tela do escritório (`components/ConexaoWhatsapp`), outro
// significado: este número atende as empresas **sem escritório** (decisão D8
// do Bloco 6B) e assina como Balu, não como um escritório.
import ConexaoWhatsapp from '@/components/ConexaoWhatsapp';
import {
  conectarPlataformaAction, statusPlataformaAction, desconectarPlataformaAction,
} from './actions';

type Props = { status: string; numero: string | null; conectadoEm: string | null };

export default function WhatsappPlataformaClient({ status, numero, conectadoEm }: Props) {
  return (
    <ConexaoWhatsapp
      status={status}
      numero={numero}
      conectadoEm={conectadoEm}
      aoConectar={conectarPlataformaAction}
      aoConsultar={statusPlataformaAction}
      aoDesconectar={desconectarPlataformaAction}
      textoConectado="É por ele que a Balu fala com as empresas sem escritório."
      instrucoes={
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Este é o <strong>número oficial do Balu</strong>. Ele atende as empresas que não
            têm escritório contábil vinculado — quem tem é atendido pelo número do escritório
            dele, configurado por lá.
          </li>
          <li>
            Use um número <strong>da empresa, não pessoal</strong>: toda conversa que chegar
            nele passa a ser atendida pelo assistente, em nome da plataforma.
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
