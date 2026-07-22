# Política de Privacidade — Balu

**Versão:** 1.0

> ⚠️ **Minuta técnica — pendente de revisão jurídica.** Este documento foi
> redigido a partir do inventário real de dados tratados pelo Balu
> (`docs/reference/inventario-dados-pessoais.md`) e descreve fielmente o que o
> sistema faz hoje. Antes de publicação, precisa de revisão por profissional
> habilitado e do preenchimento dos placeholders de identificação do
> controlador e do encarregado.

---

## 1. Quem somos

O Balu é operado por **[Controlador: razão social + CNPJ]** ("Balu", "nós"),
controlador dos dados pessoais tratados através da plataforma, nos termos da
Lei nº 13.709/2018 (LGPD).

## 2. Dados que coletamos

Coletamos apenas os dados necessários para operar o Balu como uma ferramenta
de gestão fiscal para MEI e empresas do Simples Nacional. O detalhamento
completo — categoria por categoria, com tabela de origem, finalidade, base
legal e prazo de retenção — está no
[Inventário de Dados Pessoais](../reference/inventario-dados-pessoais.md), que
é parte integrante desta política. Em resumo, tratamos:

- **Dados de conta**: e-mail, nome, papel (empresa, contador ou administrador).
- **Dados da empresa**: razão social, CNPJ, inscrições estadual/municipal, endereço, telefone, e-mail, regime tributário, CNAE.
- **Credenciais de emissão de nota fiscal e certificado digital A1**: armazenados **cifrados em repouso** (AES-256-GCM).
- **Dados de clientes do titular**: CPF/CNPJ, razão social, e-mail, telefone e endereço das pessoas físicas/jurídicas atendidas pelo titular.
- **Documentos fiscais**: notas fiscais emitidas, guias (DAS), apurações e declarações de imposto.
- **Dados de cobrança**: honorários entre o titular e o escritório contábil vinculado.
- **Registros de acesso e auditoria**: IP e ação, quando um contador acessa dados de um cliente ou quando ocorrem operações sensíveis.
- **Consentimento**: registro do aceite desta política e dos Termos de Uso, com versão e IP.

## 3. Para que usamos seus dados (finalidades)

- Operar sua conta e autenticar seu acesso.
- Emitir notas fiscais, calcular e transmitir guias e declarações fiscais, sempre com sua confirmação (ver seção 6 dos Termos de Uso).
- Permitir que um contador vinculado por convite consulte (somente leitura) os dados fiscais da sua empresa.
- Cobrar honorários do escritório contábil, quando aplicável.
- Cumprir obrigações legais de guarda de documentos fiscais.
- Prevenir fraude e garantir a segurança da plataforma (registros de auditoria).
- Enviar e-mails transacionais (confirmação de cadastro, convites, notificações).

## 4. Bases legais (LGPD art. 7º e art. 9º)

Tratamos seus dados com base em:

- **Art. 7º, I — execução de contrato**: para prestar o serviço que você contratou (cadastro, emissão fiscal, gestão de clientes, cobrança de honorários).
- **Art. 7º, II — cumprimento de obrigação legal ou regulatória**: para a guarda de documentos fiscais pelo prazo exigido pela legislação tributária (~5 anos) e para a manutenção de registros de acesso (Marco Civil da Internet, art. 15).
- **Art. 7º, IX — legítimo interesse**: para segurança da plataforma, prevenção a fraude e trilha de auditoria.
- **Art. 9º (por analogia/cautela)**: credenciais de emissão fiscal e o certificado digital A1 são tratados com o mesmo cuidado dado a dados sensíveis — cifrados em repouso e nunca expostos em texto puro, mesmo na exportação de dados (seção 8).

## 5. Compartilhamento com operadores

Compartilhamos dados com terceiros que processam informações em nosso nome
(operadores, LGPD art. 5º, VII), estritamente para viabilizar o serviço:

| Operador | Finalidade | Dados envolvidos |
|---|---|---|
| **Focus NFe** | Emissão e consulta de notas fiscais de serviço (NFS-e) | Dados da empresa, do cliente destinatário e da nota |
| **SERPRO / Integra Contador** | Transmissão de guias (DAS) e declarações (PGDAS-D/DASN-SIMEI) | Dados fiscais da empresa e do certificado digital |
| **Supabase** | Hospedagem do banco de dados, autenticação e armazenamento de arquivos | Todos os dados da plataforma |
| **Resend** | Envio de e-mails transacionais | E-mail e nome do destinatário |
| **n8n** (motor fiscal interno) | Orquestração determinística do cálculo e da emissão fiscal, sempre mediante confirmação do usuário | Dados fiscais necessários ao cálculo |

Não vendemos seus dados pessoais nem os compartilhamos para fins de
publicidade de terceiros.

## 6. Acesso do contador aos seus dados

Se você vincula sua empresa a um escritório de contabilidade (por convite que
você aceita), o contador responsável passa a ter acesso **somente leitura**
aos seus dados fiscais — ele não pode alterar seus cadastros nem seus
documentos fiscais através desse acesso. Esse acesso é sempre **consentido**
(você aceita o convite) e **revogável**. Todo acesso de um contador aos dados
de um cliente é registrado em nossa trilha de auditoria (data, ator, ação e
IP), com base no legítimo interesse de segurança (art. 7º, IX) e no
consentimento do vínculo (art. 7º, I / art. 9º).

## 7. Retenção e exclusão

- **Dados de conta** (perfil, empresa, clientes): mantidos enquanto sua conta
  estiver ativa.
- **Documentos fiscais** (notas, guias, apurações, declarações): retidos por
  cerca de **5 anos**, prazo determinado pela legislação fiscal, independente
  do estado da sua conta (LGPD art. 7º, II).
- **Ao excluir sua conta**: seus dados pessoais são **anonimizados** — nome e
  e-mail são neutralizados, seu login é bloqueado, e os dados de contato dos
  seus clientes (endereço, telefone, e-mail) também são anonimizados. Os
  **documentos fiscais são retidos de forma anonimizada** pelo prazo legal
  acima, porque sua eliminação total violaria a obrigação legal de guarda
  fiscal (LGPD art. 16, I). Não se trata, portanto, de exclusão total e
  imediata de todo o histórico — é anonimização com retenção do que a lei
  exige.
- **Registros de auditoria e acesso**: mantidos por, no mínimo, 6 meses
  (Marco Civil da Internet, art. 15), podendo ser mantidos por período maior
  por legítimo interesse de segurança.

## 8. Seus direitos (LGPD art. 18)

Você tem direito a confirmação de tratamento, acesso, correção, anonimização,
portabilidade, eliminação (nos limites da retenção legal acima) e informação
sobre compartilhamento. Na prática, hoje:

- **Acesso e portabilidade**: disponíveis diretamente na página **/conta**,
  onde você pode exportar todos os seus dados em formato JSON com um clique.
  Credenciais e o certificado digital nunca são incluídos em texto puro —
  aparecem apenas como "configurado" ou `null`.
- **Correção**: você pode atualizar nome, e-mail e senha diretamente em
  **/conta**; os demais dados cadastrais são editáveis nas telas de empresa e
  clientes.
- **Exclusão/anonimização**: também disponível em **/conta**, conforme
  descrito na seção 7.

Para outras solicitações relacionadas aos seus direitos, use o contato do
Encarregado na seção 12.

## 9. Segurança (LGPD art. 46)

Adotamos medidas técnicas e administrativas para proteger seus dados,
incluindo:

- **Isolamento por tenant (RLS)**: cada usuário só acessa, no banco de dados,
  as linhas que lhe pertencem — reforçado por Row Level Security no Postgres.
- **Cifra em repouso**: credenciais de emissão fiscal e o certificado digital
  A1 são armazenados cifrados com AES-256-GCM.
- **Rate limiting**: limites de tentativas em login, cadastro e outras
  operações sensíveis, para dificultar ataques automatizados.
- **Trilha de auditoria**: acessos do contador e operações sensíveis ficam
  registrados com data, ator e IP.

Nenhum sistema é 100% imune a incidentes; caso ocorram, seguimos o
procedimento da seção 10.

## 10. Incidentes de segurança (LGPD art. 48)

Em caso de incidente de segurança que possa acarretar risco ou dano relevante
aos titulares, comunicaremos à Autoridade Nacional de Proteção de Dados
(ANPD) e aos titulares afetados, conforme exigido pelo art. 48 da LGPD,
informando a natureza dos dados afetados, as medidas técnicas adotadas e as
recomendações aos titulares.

## 11. Cookies e sessão

Usamos apenas os cookies/mecanismos de sessão necessários para autenticação,
providos pelo Supabase Auth. Não usamos cookies de rastreamento publicitário
de terceiros.

## 12. Contato do Encarregado (DPO)

Dúvidas, solicitações sobre seus dados pessoais ou exercício dos direitos do
art. 18 podem ser enviadas para: **[Encarregado/DPO: nome + e-mail]**.

## 13. Alterações desta política

Esta política é versionada. Alterações relevantes exigem um **novo aceite**
do usuário (fluxo de re-aceite ao entrar no sistema), e a versão vigente e a
data de publicação ficam registradas internamente. A versão atual é a **1.0**.
