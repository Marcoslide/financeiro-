/**
 * Tipos e enums compartilhados entre API e Web.
 * Mantém a fonte única de verdade para papéis e estados usados nos dois lados.
 */

/** Papéis de usuário (Bloco 1). */
export enum Role {
  ADMIN = 'ADMIN',
  FINANCIAL = 'FINANCIAL',
  VIEWER = 'VIEWER',
}

export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Administrador',
  [Role.FINANCIAL]: 'Financeiro',
  [Role.VIEWER]: 'Consulta',
};

/** Situação genérica de entidades de cadastro. */
export enum EntityStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/** Fontes de ingestão de dados (upload manual hoje; APIs no futuro). */
export enum IngestionSource {
  MANUAL_UPLOAD = 'MANUAL_UPLOAD',
  INTERNAL_SHOPEE_API = 'INTERNAL_SHOPEE_API',
  SHOPEE_OFFICIAL_API = 'SHOPEE_OFFICIAL_API',
}

/**
 * Estados de conciliação (referência para os blocos seguintes).
 * Declarados aqui já no Bloco 1 para o front conhecer a nomenclatura.
 */
export enum ReconciliationState {
  PENDING_PROCESSING = 'PENDING_PROCESSING',
  AUTO_RECONCILED = 'AUTO_RECONCILED',
  PARTIALLY_RECONCILED = 'PARTIALLY_RECONCILED',
  WAITING_FOR_DATA = 'WAITING_FOR_DATA',
  WAITING_FOR_MARKETPLACE = 'WAITING_FOR_MARKETPLACE',
  VALUE_DIVERGENCE = 'VALUE_DIVERGENCE',
  UNMATCHED = 'UNMATCHED',
  MANUALLY_RECONCILED = 'MANUALLY_RECONCILED',
  IGNORED_WITH_JUSTIFICATION = 'IGNORED_WITH_JUSTIFICATION',
  REOPENED = 'REOPENED',
}

/**
 * Classificação temporal (ausência esperada × falta real) — ver
 * docs/arquitetura-e-plano.md §5.1. Referência para os blocos seguintes.
 */
export enum TemporalStatus {
  NOT_YET_EXPECTED = 'NOT_YET_EXPECTED',
  WAITING_COMPLEMENTARY_PERIOD = 'WAITING_COMPLEMENTARY_PERIOD',
  WAITING_FOR_MARKETPLACE = 'WAITING_FOR_MARKETPLACE',
  OVERDUE_DIVERGENCE = 'OVERDUE_DIVERGENCE',
  REAL_PENDENCY = 'REAL_PENDENCY',
}

/** Ações auditáveis (Bloco 1). Ampliado nos blocos seguintes. */
export enum AuditAction {
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  USER_CREATE = 'USER_CREATE',
  USER_UPDATE = 'USER_UPDATE',
  USER_DEACTIVATE = 'USER_DEACTIVATE',
  MARKETPLACE_ACCOUNT_UPDATE = 'MARKETPLACE_ACCOUNT_UPDATE',
}

/** Usuário autenticado exposto ao front (sem dados sensíveis). */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string;
}
