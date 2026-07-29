import type { Provedor } from './provedores';

/** O que o cliente precisa para falar com o provedor. A `chave` já vem
 *  DECIFRADA — decifrar é responsabilidade de quem lê a config. */
export type ConfigProvedor = {
  provedor: Provedor;
  modelo: string;
  base_url: string | null;
  chave: string;
};
