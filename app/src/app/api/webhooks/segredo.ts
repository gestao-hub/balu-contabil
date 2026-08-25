// Validacao de segredo de webhook.
//
// A implementacao mora em `lib/security/segredo.ts` desde 25/08 — subiu para la
// quando os crons passaram a precisar da mesma comparacao em tempo constante.
// Este arquivo continua existindo (e reexportando os mesmos nomes) porque as
// duas routes de webhook e `segredo.test.ts` importam daqui; mover os imports
// tambem seria churn sem ganho.
//
// Duas formas porque os provedores diferem: a Focus manda na query (?s=),
// o Asaas manda no header (asaas-access-token).
export { segredoDaQuery, segredoDoHeader, iguais } from '@/lib/security/segredo';
