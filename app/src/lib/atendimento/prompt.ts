// Bloco 6B — o prompt do atendimento. Puro, sem I/O: quem chama a IA
// (Task 6) monta o prompt aqui e passa para `gerarTexto` (lib/ai/cliente.ts,
// já existe do 6A).
//
// MESMA GARANTIA DO 6A: este módulo só recebe TEXTO já calculado
// (`situacaoFiscalTexto`, produto de `buscarSituacaoAtualMei`), nunca um valor
// numérico cru — a IA não tem como inventar um número que nunca viu.
//
// PERSONA "ASSISTENTE BALU" — pedido do usuário, com dois ajustes deliberados
// em cima do documento original (Direcionamento/PROMPT IA BALU.MD):
// 1. NÃO esconde ser IA. O documento original pedia "nunca informe que é
//    modelo de IA" — o usuário decidiu que, se perguntado diretamente, o
//    Assistente Balu responde honestamente que é um assistente virtual. Nome
//    trocado de "Paulo" (nome humano) para "Assistente Balu" a pedido do
//    usuário — mais consistente ainda com não esconder ser IA.
// 2. NÃO cita lei/artigo/prazo/multa livremente. O documento original pedia
//    respostas em tempo real com "base legal utilizada" — o usuário decidiu
//    manter a garantia central do 6A/6B: o conteúdo factual vem SÓ do texto
//    já calculado/aprovado (`situacaoFiscalTexto`), nunca de raciocínio
//    jurídico livre da IA. Isto não é o tom da conversa, é o que pode virar
//    fato — e o que pode virar fato continua do mesmo tamanho de sempre.
/**
 * A APRESENTAÇÃO DE RESERVA — e a identidade que nenhuma resposta pode perder.
 *
 * MUDOU DE PAPEL EM 24/08/2026, a pedido do usuário. Até aqui esta frase era
 * colada pelo CÓDIGO antes de toda primeira resposta, sempre igual. O efeito
 * ficou evidente no primeiro teste real: quem escrevia "olá, como você está?
 * preciso de ajuda com MEI" recebia um cumprimento genérico grudado numa
 * resposta que ignorava a pergunta social. A saudação estava lá; a conversa,
 * não.
 *
 * Agora quem cumprimenta é o MODELO, com liberdade para responder ao que a
 * pessoa efetivamente disse — e o código passou a garantir só o que não pode
 * faltar: **a identificação**. Se a primeira resposta não se apresentar,
 * `garantirApresentacao` põe esta frase na frente.
 *
 * O QUE SE PERDE, dito por escrito: a abertura deixa de ser byte a byte a mesma
 * em toda conversa. Foi decisão do usuário, e é a troca consciente de
 * "identidade idêntica" por "conversa coerente". O que NÃO se perde é o nome:
 * `IDENTIDADE` abaixo continua obrigatória, verificada em código.
 */
export const SAUDACAO_INICIAL =
  'Olá, eu sou o Assistente da Balu Contábil. Como posso te ajudar hoje?';

/**
 * O trecho que prova que o assistente se apresentou.
 *
 * É por ele que `garantirApresentacao` decide se o modelo cumpriu — e é por
 * isso que ele é curto e sem pontuação: "Assistente da Balu Contábil" aparece
 * tanto em "Olá, sou o Assistente da Balu Contábil" quanto em "eu sou o
 * Assistente da Balu Contábil, tudo bem por aqui". Exigir a frase inteira
 * transformaria a garantia em camisa de força e desfaria a adaptação.
 */
export const IDENTIDADE = 'Assistente da Balu Contábil';

/**
 * Garante que a PRIMEIRA resposta de uma conversa identifique o assistente.
 *
 * O modelo é instruído a se apresentar (ver `montarPromptAtendimento`), e na
 * prática cumpre. Isto é a rede embaixo: instrução em prompt é pedido, não
 * contrato — e a identidade do produto não pode depender de o modelo estar de
 * bom humor. Se a apresentação vier, o texto passa intocado e a conversa fica
 * natural; se não vier, a frase fixa entra na frente.
 *
 * Comparação SEM acento e SEM caixa de propósito: "assistente da balu contabil"
 * conta como apresentação. Exigir os acentos exatos faria a rede disparar em
 * cima de uma resposta perfeitamente boa, e o cliente receberia duas aberturas.
 */
export function garantirApresentacao(resposta: string, primeiraInteracao: boolean): string {
  const texto = resposta.trim();
  if (!primeiraInteracao) return texto;
  if (normalizar(texto).includes(normalizar(IDENTIDADE))) return texto;
  return `${SAUDACAO_INICIAL}\n\n${texto}`;
}

/** Tira acento e caixa — só para COMPARAR, nunca para exibir. */
function normalizar(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export type TurnoAnterior = { pergunta: string; resposta: string | null };

export type EntradaAtendimento = {
  pergunta: string;
  situacaoFiscalTexto: string | null;
  /** Trechos da base jurídica (documentos_juridicos) que casam com a pergunta.
   *  GROUNDING, NUNCA VOZ — mesma regra do 6A: servem para o assistente
   *  acertar a regra vigente, e o texto que chega ao cliente continua sem
   *  citar lei, artigo ou resolução (DL 9.295/46). */
  contextoJuridico?: { titulo: string; texto: string }[];
  /** Últimas trocas DESTA conversa, da mais antiga para a mais recente. Sem
   *  isto o assistente responde cada mensagem como se fosse a primeira, e o
   *  cliente precisa repetir tudo a cada pergunta. */
  historico?: TurnoAnterior[];
  /** 'geral' = dúvida conceitual (o que é IOF, como funciona o DAS), que a
   *  base jurídica responde mesmo sem nenhum dado da empresa. 'especifica' =
   *  depende dos números daquela empresa. Quem classifica é
   *  `lib/atendimento/classificar`, por código — não o modelo. */
  tipoPergunta?: 'geral' | 'especifica';
  /** true só na primeira mensagem desta conversa — a saudação do Assistente
   *  Balu aparece uma vez, nunca se repete (quem decide isto é o webhook,
   *  consultando se já existe atendimento anterior para este telefone). */
  primeiraInteracao?: boolean;
  /** O escritório dono do canal (migration 0091).
   *
   *  ALLOWLIST FECHADA (decisão D5, 19/08/2026): nome, prazo de resposta e
   *  WhatsApp de suporte. CNPJ, CRC, e-mail e o nome do contador responsável
   *  NÃO entram — e a garantia é esta struct não ter os campos, não a
   *  obediência do modelo. */
  escritorio?: { nome: string; slaHoras: number | null; whatsappSuporte: string | null } | null;
  /** Modo ESCRITÓRIO: resumo da carteira, já em texto e já sem dado sensível
   *  (ver `lib/atendimento/carteira.ts`). Só é montado quando quem escreve é
   *  membro do escritório dono do canal. */
  carteiraTexto?: string | null;
};

export function montarPromptAtendimento(e: EntradaAtendimento): string {
  // Sem dado fiscal, o texto muda conforme o tipo: numa dúvida geral, a
  // ausência é irrelevante e dizer "não encontramos" empurraria o modelo a
  // escalar sem necessidade.
  const contexto = e.situacaoFiscalTexto
    ?? (e.tipoPergunta === 'geral'
      ? '(não consultado — a pergunta não depende dos números da empresa)'
      : 'Não encontramos informação fiscal disponível para responder com segurança.');

  // A ABERTURA DA PRIMEIRA MENSAGEM — pedida ao modelo, não colada por cima.
  //
  // Era o contrário até 24/08/2026: o prompt PROIBIA cumprimentar e o código
  // prefixava um texto fixo. Quem escrevia "olá, como você está? preciso de
  // ajuda com MEI" recebia o cumprimento genérico grudado numa resposta que
  // ignorava a pergunta social — saudação havia, conversa não.
  //
  // As três regras abaixo são a tradução literal do que o usuário pediu, e a
  // ordem delas importa: identidade primeiro (é o que o código verifica),
  // reciprocidade depois (responder ao que foi dito), pergunta em aberto só
  // quando não há dúvida nenhuma para responder.
  const apresentacao = e.primeiraInteracao
    ? [
        'ESTA É A PRIMEIRA MENSAGEM DESTA CONVERSA. Abra a resposta assim:',
        `1. Cumprimente e identifique-se como "${IDENTIDADE}". Esta parte é`,
        '   obrigatória e deve aparecer com estas palavras.',
        '2. Responda ao que a pessoa disse ANTES da dúvida técnica. Se ela',
        '   perguntou como você está, diga que está bem, em uma frase curta e',
        '   natural. Se ela só cumprimentou, não invente assunto.',
        '3. Se houver uma dúvida na mensagem, responda-a na sequência. Se NÃO',
        '   houver nenhuma, pergunte como pode ajudar e pare por aí.',
        '',
        'Escreva como uma mensagem só, corrida — nada de lista numerada nem de',
        'repetir o cumprimento no fim.',
        '',
      ]
    // ═══ E A PROIBIÇÃO, QUANDO NÃO É A PRIMEIRA ═══
    //
    // Este ramo era `[]` — o prompt não dizia NADA sobre cumprimento fora da
    // primeira mensagem. Achado no teste de ponta a ponta de 25/08: a pessoa
    // respondeu "Sim" a uma pergunta do assistente e recebeu "Olá! Para abrir
    // um MEI…". O código não colou nada (`garantirApresentacao` só age quando
    // ninguém foi atendido); quem cumprimentou foi o MODELO, por conta própria.
    //
    // Até 24/08 o prompt PROIBIA cumprimentar em qualquer mensagem, e o código
    // prefixava o texto fixo. A parte 4 trocou a proibição por uma instrução
    // condicional para a primeira mensagem — e a proibição saiu junto, para
    // todas as outras. Silêncio não é instrução: o modelo preenche.
    : [
        'ESTA CONVERSA JÁ ESTÁ EM ANDAMENTO. Você já cumprimentou e já se',
        'identificou antes. NÃO cumprimente de novo ("olá", "oi", "bom dia") e',
        'NÃO repita quem você é. Vá direto ao que foi perguntado, como quem',
        'continua a mesma conversa.',
        '',
      ];

  // Memória: só as últimas trocas. O estado que vale é o do banco, e mandar a
  // conversa inteira encareceria o prompt e aumentaria a chance de o modelo se
  // apoiar em algo velho.
  const memoria = (e.historico ?? []).length > 0
    ? [
        'Conversa até aqui (mais antiga primeiro):',
        ...(e.historico ?? []).slice(-4).map((t) =>
          `- Cliente: ${t.pergunta}
  Assistente: ${t.resposta ?? '(sem resposta)'}`),
        '',
      ]
    : [];

  // Base jurídica: contexto interno, com instrução explícita de não virar voz.
  const juridico = (e.contextoJuridico ?? []).length > 0
    ? [
        'Material de apoio da legislação vigente (uso INTERNO, para você acertar a regra):',
        ...(e.contextoJuridico ?? []).slice(0, 4).map((t) => `- ${t.titulo}: ${t.texto.slice(0, 600)}`),
        'Use este material para responder com precisão, mas NÃO cite lei, artigo,',
        'resolução nem número de norma na sua resposta — explique em português simples.',
        '',
      ]
    : [];

  // Dados do escritório — allowlist da decisão D5. O bloco só existe quando há
  // escritório; sem ele, o modelo não tem o que dizer e não inventa nome.
  const escritorio = e.escritorio
    ? [
        `A empresa de quem escreve é atendida pelo escritório de contabilidade "${e.escritorio.nome}".`,
        ...(e.escritorio.slaHoras
          ? [`Prazo de resposta combinado com esse escritório: ${e.escritorio.slaHoras} horas.`] : []),
        ...(e.escritorio.whatsappSuporte
          ? [`WhatsApp de suporte do escritório: ${e.escritorio.whatsappSuporte}.`] : []),
        'Você PODE informar essas três coisas se perguntarem. NÃO existe nenhum',
        'outro dado do escritório disponível para você: se pedirem CNPJ, CRC,',
        'e-mail, endereço ou o nome do contador responsável, diga com naturalidade',
        'que não tem essa informação e ofereça o contato de suporte acima.',
        '',
      ]
    : [];

  // Modo ESCRITÓRIO: quem escreve é membro do escritório, não cliente final.
  const carteira = e.carteiraTexto
    ? [
        'QUEM ESTÁ FALANDO COM VOCÊ É O PRÓPRIO CONTADOR do escritório, não um',
        'cliente final. Trate-o como colega de trabalho: pode usar os termos',
        'técnicos direto, sem explicar o que é DAS ou PGDAS-D.',
        `Situação da carteira dele: ${e.carteiraTexto}`,
        'Esses números e nomes são da carteira DELE e podem ser ditos a ele.',
        'Você NÃO tem dados de clientes de outros escritórios — se ele perguntar',
        'por uma empresa que não está na carteira acima, diga que não localizou',
        'essa empresa na carteira dele.',
        '',
      ]
    : [];

  return [
    'Você é o Assistente Balu, o assistente virtual de atendimento da Balu',
    'Contabilidade, respondendo por WhatsApp.',
    '',
    '═══ A REGRA MAIS IMPORTANTE: ENTENDA INFORMAL, RESPONDA PROFISSIONAL ═══',
    '',
    'ENTRADA — quem escreve para você é LEIGO e escreve como fala: com gíria,',
    'abreviação de internet, erro de digitação, sem acento, sem pontuação, tudo em',
    'minúscula, às vezes só uma palavra solta. Entenda assim mesmo, sem reclamar e',
    'sem pedir para reformular. Exemplos que você tem de compreender de primeira:',
    '"qnt eh o mei", "to devendo imposto?", "aliquota do icms ai", "vc sabe quanto',
    'paga de das", "queria abrir um cnpj mas nao entendo nada disso", "pq desconta',
    'tanto", "blz e o simples como funfa".',
    '',
    'SAÍDA — você responde SEMPRE de forma profissional, em português correto:',
    'com acentuação, pontuação e frases completas. NUNCA use gíria, abreviação de',
    'internet (vc, pq, blz, tmj, qnt), nem imite o jeito de escrever de quem',
    'perguntou. Se o cliente escreve "qnt eh o mei", você responde "O MEI é o',
    'Microempreendedor Individual...". O tom é cordial, claro e acolhedor —',
    'profissional sem ser rígido, nunca íntimo, nunca irônico, nunca sarcástico.',
    'Não trate por "prezado" nem escreva como ofício: profissional é ser correto e',
    'respeitoso, não ser burocrático.',
    '',
    'Se a mensagem estiver ambígua, responda com a interpretação MAIS PROVÁVEL e,',
    'no fim, ofereça a alternativa numa pergunta curta. NUNCA responda apenas',
    '"não entendi" nem devolva a pergunta sem conteúdo nenhum: ficar sem resposta',
    'é o pior resultado possível para quem está do outro lado.',
    '',
    'Jargão técnico só quando explicado na mesma frase ("DAS, que é a guia mensal',
    'do MEI").',
    'Se o cliente perguntar diretamente se você é uma inteligência artificial ou',
    'assistente virtual, responda honestamente que sim.',
    ...apresentacao,
    ...escritorio,
    ...carteira,
    ...memoria,
    ...juridico,
    `Pergunta do cliente: "${e.pergunta}"`,
    `O que já sabemos sobre a situação fiscal dele: ${contexto}`,
    '',
    'Responda curto — 2 a 5 frases, do tamanho de uma mensagem de WhatsApp —, em',
    'português correto e simples, usando SOMENTE a informação acima (situação',
    'fiscal, material de apoio e o que já foi dito nesta conversa).',
    'Nunca invente valor, data, norma, lei, artigo, prazo ou multa que não esteja no',
    'texto acima. Nunca oriente sonegação, fraude nem forma de burlar a fiscalização.',
    // ⚠️ MODO ESCRITÓRIO TEM FECHO PRÓPRIO — descoberto no smoke de 19/08/2026.
    //
    // Sem este ramo, a conversa com o contador caía no fecho de 'especifica':
    // "se a situação fiscal acima não trouxer o que responder, diga que vai
    // encaminhar para o contador". Com a carteira INTEIRA no prompt logo acima,
    // o modelo respondia "não localizamos informações sobre a regularidade dos
    // clientes, vou encaminhar" — para o próprio contador. A instrução vencia
    // o dado, e o dado estava lá.
    ...(e.carteiraTexto
      ? [
          'Responda usando os números da carteira acima — eles são a informação',
          'que você tem, e são suficientes. NÃO diga que vai encaminhar para o',
          'contador: quem está perguntando É o contador. Se ele pedir algo que',
          'não está acima, diga o que falta e sugira o painel do escritório.',
          'Use "resolvido": true quando conseguir responder com esses dados.',
        ]
      : e.tipoPergunta === 'geral'
      ? [
          'ESTA É UMA DÚVIDA GERAL sobre como funcionam impostos e obrigações — não',
          'depende dos números da empresa de quem perguntou. Responda com o material de',
          'apoio acima, de forma didática, ainda que não haja dado fiscal do cliente.',
          'Não encaminhe para o contador só porque falta a situação fiscal dele.',
          'Não cite valor específico da empresa dele; se ele quiser o próprio número,',
          'convide a perguntar sobre isso em seguida.',
          'Se conseguiu explicar, use "resolvido": true.',
        ]
      : [
          'ESTA PERGUNTA É SOBRE A EMPRESA DE QUEM PERGUNTOU. Se a situação fiscal acima',
          'não trouxer o que responder, NÃO tente deduzir nem responder de forma genérica:',
          'diga que vai encaminhar para o contador e use "resolvido": false.',
        ]),
    '',
    'Responda em JSON, só com estas duas chaves: ',
    '{ "resposta": "...", "resolvido": true ou false }',
  ].join('\n');
}
