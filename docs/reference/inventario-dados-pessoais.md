# Inventário de dados pessoais — Balu

> ⚠️ **Minuta técnica — pendente de revisão jurídica.** Este inventário é a base
> factual (o que o sistema efetivamente coleta e armazena, hoje) usada para
> redigir a Política de Privacidade e os Termos de Uso. Não substitui um
> relatório de impacto (RIPD) nem uma auditoria jurídica formal.

Base: schema real do banco (`docs/reference/db_atual.sql`) e código em
`app/src/` na data desta minuta (Bloco E — Hardening e LGPD).

## Legenda de base legal (LGPD, art. 7º e art. 9º)

- **Art. 7º, I** — execução de contrato ou procedimentos preliminares (o titular contratou o uso do app).
- **Art. 7º, II** — cumprimento de obrigação legal ou regulatória (guarda fiscal/contábil).
- **Art. 7º, IX** — legítimo interesse do controlador (segurança, prevenção a fraude, auditoria).
- **Art. 9º** — dado sensível/de acesso restrito (aqui: credenciais e certificado digital, tratados como dado sensível de acesso por decisão de segurança, não porque a LGPD os classifique formalmente como "dado sensível" no sentido do art. 5º, II — a cautela é adotada por analogia, dado o risco de uso indevido).

## Inventário

| Categoria de dado | Tabela/origem | Finalidade | Base legal (LGPD) | Retenção | Titular |
|---|---|---|---|---|---|
| Identificação/autenticação (e-mail, nome, papel) | `auth.users` (user_metadata), `profiles`, `role_types` | Login, identificação do usuário, controle de papel (empresa/contador/AdminBalu) | Art. 7º, I | Enquanto a conta estiver ativa; anonimizado na exclusão (nome neutralizado, e-mail substituído por marcador interno, login banido) | Usuário da conta (empresa, contador ou admin) |
| Dados da empresa (razão social, nome, CNPJ, inscrições, endereço, telefone, e-mail, código do município) | `companies` | Cadastro da empresa, base para emissão de notas e apuração fiscal | Art. 7º, I; Art. 7º, II (dado exigido para cumprimento de obrigações fiscais) | Enquanto a conta/empresa estiver ativa; na exclusão a empresa é marcada `deleted_at` e desvinculada do escritório (dados fiscais associados são retidos, ver linha "Documentos fiscais") | Titular da empresa (MEI/Simples Nacional) |
| Dados fiscais da empresa (regime tributário, CNAE, anexo do Simples, credenciais NFS-e, configurações de emissão) | `empresas_fiscais` | Configurar e operar a emissão de notas fiscais e cálculo de imposto | Art. 7º, I; Art. 7º, II | Mesma retenção da empresa. Credenciais (login/senha/token/chave NFS-e) ficam **cifradas em repouso** (AES-256-GCM) | Titular da empresa |
| Certificado digital A1 e senha | `arquivos_auxiliares` | Autenticação da empresa perante a Receita/prefeitura para emissão de nota e transmissão de guias | Art. 7º, I; Art. 7º, II; tratado com cautela de dado sensível de acesso (analogia ao art. 9º) | Enquanto vigente/necessário à operação; material do certificado e senha são **cifrados em repouso** (AES-256-GCM) | Titular da empresa |
| Clientes do titular (pessoas físicas/jurídicas atendidas) — CPF/CNPJ, razão social, e-mail, telefone, endereço | `clientes` | Emitir nota fiscal e gerir a carteira de clientes do titular | Art. 7º, I; Art. 7º, II (CPF/CNPJ exigido para a guarda do documento fiscal) | Contato/endereço/nome anonimizados na exclusão da conta do titular; o campo `document` (CPF/CNPJ) é **retido** porque é exigido para a guarda do documento fiscal associado (retenção ~5 anos) | Cliente/terceiro do titular (não é usuário direto do app) |
| Documentos fiscais (notas emitidas, guias DAS, apurações de imposto, declarações PGDAS-D/DASN-SIMEI) | `notas_fiscais`, `guias_fiscais`, `apuracoes_fiscais`, `declaracoes_fiscais` | Emissão fiscal, apuração e declaração de tributos do Simples Nacional | Art. 7º, II (obrigação legal/regulatória — guarda fiscal) | ~5 anos (prazo da legislação fiscal/decadencial), independente do estado da conta. Na exclusão da conta, os documentos são **retidos de forma anonimizada** (não são apagados) | Titular da empresa; dados do cliente destinatário da nota, quando aplicável |
| Honorários (cobranças do escritório ao cliente) | `honorarios` | Cobrança de honorários contábeis do titular pelo escritório vinculado | Art. 7º, I | Enquanto a conta/vínculo estiver ativo; segue a retenção geral de dados de conta | Titular da empresa (cliente do escritório) |
| Escritório contábil (contabilidade, membros, convites) | `contabilidades`, `contabilidade_membros`, `convites` | Operação do escritório contábil, gestão de equipe e vínculo consentido com clientes | Art. 7º, I | Enquanto o escritório/vínculo estiver ativo | Contador/escritório e seus membros |
| Consentimento (aceite de Termos/Política, versão, IP) | `aceites` | Registrar o aceite versionado dos documentos legais (evidência de consentimento/contrato) | Art. 7º, I | Enquanto a conta existir (é evidência de conformidade, retida junto com o histórico da conta) | Usuário da conta |
| Trilha de auditoria (acesso do contador aos dados do cliente + escritas sensíveis, com IP) | `audit_log` | Segurança, prevenção a fraude, comprovação de acesso do contador sob consentimento | Art. 7º, IX; Marco Civil da Internet, art. 15 (guarda de registros de acesso) | Mínimo 6 meses (Marco Civil, art. 15); mantido por período maior por legítimo interesse de segurança, a critério do controlador | Todos os usuários (registro do ator que agiu, não do titular do dado acessado) |

## Terceiros que processam dados (operadores)

| Operador | Papel | Dados compartilhados | Finalidade |
|---|---|---|---|
| Focus NFe | Operador | Dados da empresa, do cliente destinatário e da nota fiscal | Emissão e consulta de notas fiscais de serviço (NFS-e) |
| SERPRO / Integra Contador | Operador | Dados fiscais da empresa (CNPJ, regime) e do certificado digital | Transmissão de guias (DAS) e declarações (PGDAS-D/DASN-SIMEI) |
| Supabase | Operador (infraestrutura) | Todo o banco de dados, autenticação e armazenamento de arquivos | Hospedagem do banco (Postgres com RLS), autenticação e storage |
| Resend | Operador | E-mail e nome do destinatário | Envio de e-mails transacionais (confirmação, convite, notificação) |
| n8n (motor fiscal) | Operador (infraestrutura interna) | Dados fiscais necessários ao cálculo/orquestração | Motor de automação fiscal via webhooks (`webhooks.envia.click`) — determinístico, sempre com confirmação do usuário antes de qualquer transmissão |

## Observações

- O acesso do contador aos dados do cliente é **somente leitura**, mediante vínculo
  consentido (convite aceito pelo titular) — LGPD art. 7º e art. 9º combinados com
  o modelo de RLS multi-tenant do banco.
- O app **nunca transmite declaração nem emite nota fiscal automaticamente**: o
  fluxo é determinístico e depende de confirmação explícita do usuário; a IA do
  produto apenas explica, nunca decide ou transmite.
- Exclusão de conta = anonimização dos dados pessoais + retenção dos documentos
  fiscais de forma anonimizada pelo prazo legal (LGPD art. 16, I — cumprimento de
  obrigação legal), não exclusão total.
