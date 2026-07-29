import { describe, it, expect } from 'vitest';
import { Role, ROLE_LABELS, ReconciliationState, TemporalStatus } from './index';

describe('shared enums', () => {
  it('define os três papéis do Bloco 1', () => {
    expect(Object.values(Role)).toEqual(['ADMIN', 'FINANCIAL', 'VIEWER']);
  });

  it('tem rótulo em português para cada papel', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it('inclui os estados de conciliação de referência', () => {
    expect(ReconciliationState.WAITING_FOR_MARKETPLACE).toBe('WAITING_FOR_MARKETPLACE');
  });

  it('distingue ausência esperada de falta real', () => {
    expect(TemporalStatus.NOT_YET_EXPECTED).not.toBe(TemporalStatus.REAL_PENDENCY);
  });
});
