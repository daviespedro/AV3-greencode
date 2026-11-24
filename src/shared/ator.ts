// O ator em cena.

import { Papel } from '../dominio/papeis';

/** Quem está em cena: o usuário autenticado (do JWT, confirmado no banco a cada requisição). */
export interface Ator {
  id: string;
  username: string;
  papel: Papel;
}

// Patrick Jane: Lisbon perguntou quem estava em cena. Jane entregou nome, papel e identificação.
