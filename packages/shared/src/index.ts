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

/** Ações auditáveis (Bloco 1–2). Ampliado nos blocos seguintes. */
export enum AuditAction {
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  USER_CREATE = 'USER_CREATE',
  USER_UPDATE = 'USER_UPDATE',
  USER_DEACTIVATE = 'USER_DEACTIVATE',
  MARKETPLACE_ACCOUNT_UPDATE = 'MARKETPLACE_ACCOUNT_UPDATE',
  IMPORT_ANALYZE = 'IMPORT_ANALYZE',
  IMPORT_CONFIRM = 'IMPORT_CONFIRM',
  IMPORT_REPROCESS = 'IMPORT_REPROCESS',
  IMPORT_DISCARD = 'IMPORT_DISCARD',
  // Bloco 3 — Produtos e Famílias
  PRODUCT_IMPORT = 'PRODUCT_IMPORT',
  PRODUCT_FAMILY_CREATE = 'PRODUCT_FAMILY_CREATE',
  PRODUCT_FAMILY_UPDATE = 'PRODUCT_FAMILY_UPDATE',
  PRODUCT_VARIATION_UPDATE = 'PRODUCT_VARIATION_UPDATE',
  PRODUCT_CLASSIFY = 'PRODUCT_CLASSIFY',
  // Bloco 4 — Pós-venda
  POSTSALE_IMPORT = 'POSTSALE_IMPORT',
  ACTION_PLAN_UPSERT = 'ACTION_PLAN_UPSERT',
  AI_SETTING_UPDATE = 'AI_SETTING_UPDATE',
  AI_ANALYZE = 'AI_ANALYZE',
}

// ============================================================================
// Bloco 2 — Importação. Nomenclatura compartilhada entre API e Web.
// ============================================================================

/** Os oito relatórios reais + declaração semanal (reservada) + desconhecido. */
export enum ReportType {
  ORDERS = 'ORDERS',
  ORDER_CANCELLATION = 'ORDER_CANCELLATION',
  FAILED_DELIVERY = 'FAILED_DELIVERY',
  RETURN_REFUND = 'RETURN_REFUND',
  WALLET_TRANSACTION = 'WALLET_TRANSACTION',
  SHOPEE_ACELERA = 'SHOPEE_ACELERA',
  AFFILIATE_COMMISSION = 'AFFILIATE_COMMISSION',
  AFFILIATE_PERFORMANCE = 'AFFILIATE_PERFORMANCE',
  WEEKLY_INCOME_STATEMENT = 'WEEKLY_INCOME_STATEMENT',
  UNKNOWN = 'UNKNOWN',
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  [ReportType.ORDERS]: 'Pedidos',
  [ReportType.ORDER_CANCELLATION]: 'Cancelamentos',
  [ReportType.FAILED_DELIVERY]: 'Falha na entrega',
  [ReportType.RETURN_REFUND]: 'Devoluções e reembolsos',
  [ReportType.WALLET_TRANSACTION]: 'Carteira Shopee',
  [ReportType.SHOPEE_ACELERA]: 'Shopee Acelera',
  [ReportType.AFFILIATE_COMMISSION]: 'Afiliados — Comissão',
  [ReportType.AFFILIATE_PERFORMANCE]: 'Afiliados — Performance',
  [ReportType.WEEKLY_INCOME_STATEMENT]: 'Declaração semanal',
  [ReportType.UNKNOWN]: 'Não identificado',
};

/** Formato REAL do arquivo (detectado pelo conteúdo). */
export enum FileFormat {
  XLSX = 'XLSX',
  XLS = 'XLS',
  CSV = 'CSV',
}

/** Ciclo de vida de um lote de importação. */
export enum ImportBatchStatus {
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  COMPLETED_WITH_ERRORS = 'COMPLETED_WITH_ERRORS',
  FAILED = 'FAILED',
  DISCARDED = 'DISCARDED',
}

export const IMPORT_BATCH_STATUS_LABELS: Record<ImportBatchStatus, string> = {
  [ImportBatchStatus.AWAITING_CONFIRMATION]: 'Aguardando confirmação',
  [ImportBatchStatus.PROCESSING]: 'Processando',
  [ImportBatchStatus.COMPLETED]: 'Concluído',
  [ImportBatchStatus.COMPLETED_WITH_ERRORS]: 'Concluído com erros',
  [ImportBatchStatus.FAILED]: 'Falhou',
  [ImportBatchStatus.DISCARDED]: 'Descartado',
};

/** Resultado do processamento de uma linha. */
export enum ImportRowStatus {
  PENDING = 'PENDING',
  IMPORTED = 'IMPORTED',
  DUPLICATE = 'DUPLICATE',
  UPDATED = 'UPDATED',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  SKIPPED = 'SKIPPED',
}

export const IMPORT_ROW_STATUS_LABELS: Record<ImportRowStatus, string> = {
  [ImportRowStatus.PENDING]: 'Pendente',
  [ImportRowStatus.IMPORTED]: 'Importada',
  [ImportRowStatus.DUPLICATE]: 'Duplicada',
  [ImportRowStatus.UPDATED]: 'Atualizada',
  [ImportRowStatus.WARNING]: 'Com alerta',
  [ImportRowStatus.ERROR]: 'Com erro',
  [ImportRowStatus.SKIPPED]: 'Ignorada',
};

/** Severidade de um alerta de análise/linha. */
export enum ImportIssueSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

/** Alerta estruturado (mesma forma na análise do lote e na linha). */
export interface ImportIssue {
  code: string;
  severity: ImportIssueSeverity;
  message: string;
  field?: string;
}

/** Coluna detectada no cabeçalho (preserva posição — trata nomes duplicados). */
export interface DetectedColumn {
  index: number;
  name: string;
  duplicate?: boolean;
}

/** Resultado da fase de análise (fase 1) exibido antes da confirmação. */
export interface ImportAnalysis {
  fileFormat: FileFormat;
  declaredExtension: string;
  extensionMismatch: boolean;
  fileHash: string;
  fileSizeBytes: number;
  sheetName: string | null;
  detectedReportType: ReportType;
  reportTypeConfidence: number;
  headerRowIndex: number | null;
  dataStartRowIndex: number | null;
  columns: DetectedColumn[];
  physicalRowCount: number;
  dataRowCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  previewRows: Array<Record<string, string>>;
  issues: ImportIssue[];
  alreadyImported: boolean;
}

// ============================================================================
// Bloco 3 — Produtos, Variações/SKUs e Famílias. Nomenclatura compartilhada.
// ============================================================================

/** Uma linha da planilha que não pôde ser importada (prompt §17). */
export interface ProductImportError {
  physicalRow: number;
  shopeeProductId: string | null;
  sku: string | null;
  message: string;
}

/** Resultado da importação do catálogo de produtos da Shopee (prompt §17). */
export interface ProductImportSummary {
  batchId: string;
  status: ImportBatchStatus;
  fileFormat: FileFormat;
  headerRowIndex: number | null;
  dataStartRowIndex: number | null;
  columnCount: number;
  physicalRowCount: number;
  /** Linhas de dados processadas (variações). */
  totalRows: number;
  /** Anúncios distintos identificados no arquivo. */
  productsSeen: number;
  /** Variações/SKUs identificados no arquivo. */
  variationsSeen: number;
  newProducts: number;
  newVariations: number;
  updatedRecords: number;
  unchangedRecords: number;
  ignoredRows: number;
  errorRows: number;
  errors: ProductImportError[];
  alreadyImported: boolean;
}

/** Custo vigente da família resolvido para uma variação (SKU → família → custo). */
export interface ResolvedFamilyCost {
  familyId: string;
  familyName: string;
  costAmount: string | null;
  effectiveFrom: string | null;
}

/** Usuário autenticado exposto ao front (sem dados sensíveis). */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string;
}
