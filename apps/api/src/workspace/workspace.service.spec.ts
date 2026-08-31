import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mergeWorkspaceItems, WORKSPACE_STORE_NAMES } from './workspace.service';

describe('sincronização organizacional da V1', () => {
  it('mantém a lista fechada das 61 stores compartilhadas', () => {
    expect(WORKSPACE_STORE_NAMES).toHaveLength(61);
    expect(new Set(WORKSPACE_STORE_NAMES).size).toBe(61);
  });

  it('mescla alterações por id sem apagar registros de outro usuário', () => {
    const result = mergeWorkspaceItems(
      [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ],
      [
        { id: 'b', value: 20 },
        { id: 'c', value: 3 },
      ],
      [],
    );
    expect(result).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 20 },
      { id: 'c', value: 3 },
    ]);
  });

  it('aplica exclusões explícitas e permite recriar o mesmo id no mesmo patch', () => {
    const result = mergeWorkspaceItems(
      [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ],
      [{ id: 'b', value: 22 }],
      ['a', 'b'],
    );
    expect(result).toEqual([{ id: 'b', value: 22 }]);
  });

  it('rejeita registros sem id em vez de persistir dados irrecuperáveis', () => {
    expect(() => mergeWorkspaceItems([], [{ value: 1 }], [])).toThrow(BadRequestException);
  });
});
