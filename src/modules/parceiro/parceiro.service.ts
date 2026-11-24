import { EscopoParceiro } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { transacao } from '../../db';
import { erroNaoAutenticado, erroNaoEncontrado } from '../../errors';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import { Pagina } from '../../shared/http';
import {
  consumirLimite, criarChave, localizarLote, localizarRastreio, marcarRevogada, obterChave, organizacaoAtiva,
} from './parceiro.repository';

export type { Acesso } from './parceiro.repository';
export { listarChaves } from './parceiro.repository';

const hashDaChave = (chave: string) => createHash('sha256').update(chave).digest('hex');
export interface EmissaoChave {
  organizacaoId: string;
  nome: string;
  escopos: EscopoParceiro[];
  limiteMinuto?: number;
  validadeDias?: number;
}

export function emitirChave(usuarioId: string, entrada: EmissaoChave) {
  const chave = 'gc_' + randomBytes(32).toString('base64url');
  return transacao(async db => {
    const organizacao = await organizacaoAtiva(db, entrada.organizacaoId);
    if (!organizacao) throw erroNaoEncontrado('Organização ativa não encontrada.');
    const credencial = await criarChave(db, {
      organizacaoId: organizacao.id, emitidaPorId: usuarioId, nome: entrada.nome.trim(),
      hash: hashDaChave(chave), escopos: entrada.escopos, limiteMinuto: entrada.limiteMinuto ?? 60,
      expiraEm: new Date(Date.now() + (entrada.validadeDias ?? 90) * 86_400_000),
    });
    await auditoriaRepo.registrar(db, usuarioId, 'CHAVE_PARCEIRO_EMITIDA', { chaveId: credencial.id, organizacaoId: organizacao.id });
    return { ...credencial, chave };
  });
}

export function revogarChave(usuarioId: string, id: string) {
  return transacao(async db => {
    const alteradas = await marcarRevogada(db, id);
    if (alteradas.count > 0) await auditoriaRepo.registrar(db, usuarioId, 'CHAVE_PARCEIRO_REVOGADA', { chaveId: id });
    return obterChave(db, id);
  });
}

export async function autenticarParceiro(chave: unknown) {
  const invalida = () => erroNaoAutenticado('Chave de API ausente, inválida ou expirada.');
  if (typeof chave !== 'string' || !/^gc_[\w-]{43}$/.test(chave)) throw invalida();
  const acesso = await consumirLimite(hashDaChave(chave));
  if (!acesso) throw invalida();
  return acesso;
}

export async function obterLote(organizacaoId: string, id: string) {
  const lote = await localizarLote(organizacaoId, id);
  if (!lote) throw erroNaoEncontrado('Lote ativo não encontrado.');
  return lote;
}

export async function obterRastreio(organizacaoId: string, id: string, pagina: Pagina) {
  const rastreio = await localizarRastreio(organizacaoId, id, pagina);
  if (!rastreio) throw erroNaoEncontrado('Equipamento ativo não encontrado.');
  return rastreio;
}

// Patrick Jane: Jane viu o lacre da credencial. Van Pelt guardou só a impressão digital dela.
