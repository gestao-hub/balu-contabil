# Termos de Uso — Balu

**Versão:** 1.0

> ⚠️ **Minuta técnica — pendente de revisão jurídica.** Este documento foi
> redigido a partir do comportamento real do sistema (Bloco E — Hardening e
> LGPD) e descreve fielmente o que o Balu faz e não faz hoje. Antes de
> publicação, precisa de revisão por profissional habilitado e do
> preenchimento dos placeholders de identificação do controlador.

---

## 1. Objeto

O Balu é um SaaS de gestão fiscal voltado a Microempreendedores Individuais
(MEI) e empresas optantes pelo Simples Nacional, oferecido por
**[Controlador: razão social + CNPJ]**. O serviço apoia o cadastro de empresas
e clientes, a emissão de notas fiscais de serviço, o cálculo e a transmissão
de guias (DAS) e declarações fiscais, e a gestão do relacionamento entre o
titular da empresa e um escritório de contabilidade, quando vinculado.

## 2. Cadastro e conta

Para usar o Balu você precisa criar uma conta com e-mail e senha válidos e
manter seus dados cadastrais atualizados e corretos. Você é responsável por
todas as atividades realizadas na sua conta.

## 3. Papéis de usuário

O Balu opera com três papéis:

- **Empresa**: titular de um MEI/empresa do Simples Nacional, dono dos seus
  próprios dados fiscais e de clientes.
- **Contador**: profissional vinculado a um escritório de contabilidade
  (contabilidade), que pode ser convidado por uma empresa para acompanhar seus
  dados fiscais.
- **AdminBalu**: administração da plataforma, com acesso operacional restrito
  ao necessário para suporte, auditoria e governança do escritório contábil.

## 4. Acesso do contador aos seus dados

Quando você aceita o convite de um escritório de contabilidade, o contador
responsável passa a ter acesso **somente leitura** aos seus dados fiscais —
ele não pode alterar seus cadastros ou documentos através desse vínculo. Esse
acesso é **consentido** por você no momento da aceitação do convite e pode ser
**revogado** a qualquer momento. Todo acesso do contador aos seus dados fica
registrado em nossa trilha de auditoria.

## 5. Obrigações do usuário

Ao usar o Balu, você se compromete a:

- Fornecer dados corretos, completos e atualizados sobre sua empresa e seus
  clientes;
- Manter suas credenciais de acesso (senha, credenciais de emissão de nota
  fiscal, certificado digital) em sigilo e sob sua guarda;
- Usar o serviço apenas para finalidades lícitas, compatíveis com a legislação
  fiscal e com estes Termos;
- Conferir os dados apresentados antes de confirmar qualquer emissão,
  cálculo ou transmissão (ver seção 6).

## 6. Natureza do serviço e limitações

**O Balu não transmite declarações fiscais nem emite notas fiscais de forma
automática.** Todo cálculo segue um fluxo determinístico e toda emissão ou
transmissão só ocorre mediante **confirmação explícita do usuário**. A
inteligência artificial presente no produto tem papel exclusivamente
explicativo — ela ajuda a entender números, prazos e obrigações, mas **nunca
decide, calcula de forma não determinística, nem transmite ou emite nada em
seu nome**. A responsabilidade pela conferência final dos dados antes de
confirmar uma ação é do usuário.

O Balu é uma ferramenta de apoio à gestão fiscal e não substitui a orientação
de um contador habilitado quanto a decisões tributárias específicas do seu
negócio.

## 7. Disponibilidade e operadores terceiros

O Balu depende de serviços de terceiros para funcionar (Focus NFe para
emissão de notas; SERPRO/Integra Contador para guias e declarações; Supabase
para banco de dados, autenticação e armazenamento; Resend para e-mails). A
disponibilidade e o desempenho do Balu podem ser afetados por
indisponibilidades desses serviços, fora do nosso controle direto.
Envidaremos esforços razoáveis para manter o serviço disponível, mas não
garantimos disponibilidade ininterrupta.

## 8. Propriedade intelectual

O software, a marca, o layout e os demais elementos do Balu são de
propriedade de **[Controlador: razão social + CNPJ]** ou de seus licenciantes.
O uso do serviço não transfere a você qualquer direito de propriedade
intelectual sobre a plataforma. Os dados que você insere no Balu (dados da
sua empresa, dos seus clientes, seus documentos fiscais) continuam sendo seus.

## 9. Cancelamento

Você pode cancelar sua conta a qualquer momento, sem barreiras ou
procedimentos que dificultem a saída, conforme o Código de Defesa do
Consumidor. O cancelamento é feito diretamente na página **/conta**.

## 10. Exclusão de conta

Ao excluir sua conta, seus dados pessoais são **anonimizados** e seu acesso é
encerrado (login bloqueado). Os **documentos fiscais são retidos de forma
anonimizada** pelo prazo exigido pela legislação fiscal (cerca de 5 anos),
porque sua eliminação total violaria obrigação legal de guarda (LGPD art. 16,
I). Não se trata, portanto, de apagamento total e imediato de todo o
histórico — é anonimização com retenção do que a lei exige. Detalhes em nossa
[Política de Privacidade](./politica-de-privacidade-v1.md), seção 7.

## 11. Limitação de responsabilidade

O Balu é fornecido "como está". Na máxima extensão permitida pela legislação
aplicável, não respondemos por danos indiretos decorrentes de indisponibilidade
de terceiros (seção 7), de dados incorretos fornecidos pelo usuário, ou do uso
do serviço em desacordo com estes Termos. Nada nesta cláusula limita direitos
que não possam ser limitados por lei, incluindo os direitos do consumidor.

## 12. Alterações destes Termos

Estes Termos são versionados. Alterações relevantes exigem um **novo aceite**
do usuário (fluxo de re-aceite ao entrar no sistema), e a versão vigente e a
data de publicação ficam registradas internamente. A versão atual é a **1.0**.

## 13. Foro

Fica eleito o foro **[a definir]** para dirimir eventuais controvérsias
decorrentes destes Termos, com renúncia a qualquer outro, por mais
privilegiado que seja, ressalvadas as regras de competência do Código de
Defesa do Consumidor quando aplicáveis.
