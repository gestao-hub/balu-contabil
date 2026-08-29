// Mensagens de validação em português — o errorMap global do Zod.
//
// POR QUE EXISTE (BUG-004, auditoria 29/08/2026). Salvar um cliente vazio
// devolvia `String must contain exactly 2 character(s)` e `Invalid email` numa
// interface inteiramente em português. Não era descuido de um formulário: o
// `types/zod.ts` tem 174 usos de `z.` e cerca de 109 sem `message` própria, e
// todos eles cairiam no texto padrão em inglês da biblioteca.
//
// POR QUE UM ERRORMAP GLOBAL, e não `message` campo a campo. Traduzir 109
// pontos é trabalho que precisa ser refeito a cada schema novo — e o schema
// novo que esquecer o `message` volta a falar inglês sem ninguém notar. Aqui a
// tradução é o PADRÃO, e `message` própria continua sendo o jeito de dizer algo
// mais específico que "campo obrigatório".
//
// PRECEDÊNCIA (Zod 3): mensagem do schema > errorMap de contexto > errorMap
// global > padrão da lib. Ou seja, isto NÃO sobrescreve as mensagens que já
// existem — `'CNPJ deve ter 14 dígitos.'` e as outras seguem valendo.
import { z } from 'zod';

/** Plural sem gambiarra de template — "1 caractere" / "2 caracteres". */
function caracteres(n: number): string {
  return n === 1 ? '1 caractere' : `${n} caracteres`;
}

export const mensagensPtBr: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      // Campo não preenchido é o caso mais comum de todos, e o que mais
      // precisa de texto claro: "Expected string, received undefined" não diz
      // à pessoa o que fazer.
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Campo obrigatório.' };
      }
      if (issue.expected === 'number') return { message: 'Informe um número.' };
      return { message: 'Valor inválido.' };
    }

    case z.ZodIssueCode.invalid_string: {
      if (issue.validation === 'email') return { message: 'E-mail inválido.' };
      if (issue.validation === 'url') return { message: 'Endereço (URL) inválido.' };
      if (issue.validation === 'uuid') return { message: 'Identificador inválido.' };
      if (issue.validation === 'regex') return { message: 'Formato inválido.' };
      return { message: 'Texto inválido.' };
    }

    case z.ZodIssueCode.too_small: {
      const min = Number(issue.minimum);
      if (issue.type === 'string') {
        // `.length(n)` chega como too_small/too_big com exact — e é justamente
        // o caso da UF, que gerou `String must contain exactly 2 character(s)`.
        if (issue.exact) return { message: `Deve ter exatamente ${caracteres(min)}.` };
        if (min <= 1) return { message: 'Campo obrigatório.' };
        return { message: `Informe ao menos ${caracteres(min)}.` };
      }
      if (issue.type === 'number') {
        return issue.inclusive
          ? { message: `Deve ser no mínimo ${min}.` }
          : { message: `Deve ser maior que ${min}.` };
      }
      if (issue.type === 'array') {
        return min <= 1
          ? { message: 'Adicione ao menos um item.' }
          : { message: `Adicione ao menos ${min} itens.` };
      }
      return { message: 'Valor abaixo do permitido.' };
    }

    case z.ZodIssueCode.too_big: {
      const max = Number(issue.maximum);
      if (issue.type === 'string') {
        if (issue.exact) return { message: `Deve ter exatamente ${caracteres(max)}.` };
        return { message: `Use no máximo ${caracteres(max)}.` };
      }
      if (issue.type === 'number') {
        return issue.inclusive
          ? { message: `Deve ser no máximo ${max}.` }
          : { message: `Deve ser menor que ${max}.` };
      }
      if (issue.type === 'array') return { message: `Use no máximo ${max} itens.` };
      return { message: 'Valor acima do permitido.' };
    }

    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Opção inválida.' };

    case z.ZodIssueCode.invalid_date:
      return { message: 'Data inválida.' };

    case z.ZodIssueCode.not_multiple_of:
      return { message: `Deve ser múltiplo de ${issue.multipleOf}.` };

    case z.ZodIssueCode.unrecognized_keys:
      return { message: 'Há campos não reconhecidos.' };

    default:
      // Inclui `custom` — que é por onde passam os `.refine()` do projeto, e
      // esses JÁ trazem mensagem própria em português (`'CNPJ inválido.'`).
      // Cair no padrão aqui é o comportamento certo.
      return { message: ctx.defaultError };
  }
};

/** Idempotente: chamar de novo só reinstala o mesmo mapa. */
export function instalarMensagensPtBr(): void {
  z.setErrorMap(mensagensPtBr);
}
