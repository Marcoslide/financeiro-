import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AuditAction } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostSaleService } from '../postsale/postsale.service';
import { encryptSecret, decryptSecret } from '../common/crypto';
import { buildProvider, SUPPORTED_PROVIDERS, DEFAULT_MODELS } from './providers/factory';
import { AIProviderError } from './providers/types';
import { getFunction, sanitizeUntrusted } from './prompts';

interface PeriodFilter {
  from?: Date;
  to?: Date;
}

/** Resposta de configuração — NUNCA inclui a chave (§46). */
export interface AiSettingsView {
  provider: string;
  model: string;
  enabled: boolean;
  hasKey: boolean;
  supportedProviders: readonly string[];
  defaultModels: Record<string, string>;
  updatedAt: Date | null;
}

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly postSale: PostSaleService,
    private readonly config: ConfigService,
  ) {}

  private encKey(): string {
    return this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  // ---------------------------------------------------------------- Config
  async getSettings(organizationId: string): Promise<AiSettingsView> {
    const s = await this.prisma.aiSetting.findUnique({ where: { organizationId } });
    return {
      provider: s?.provider ?? 'anthropic',
      model: s?.model ?? DEFAULT_MODELS.anthropic,
      enabled: s?.enabled ?? false,
      hasKey: !!s?.encryptedApiKey,
      supportedProviders: SUPPORTED_PROVIDERS,
      defaultModels: DEFAULT_MODELS,
      updatedAt: s?.updatedAt ?? null,
    };
  }

  async updateSettings(
    organizationId: string,
    userId: string,
    dto: { provider?: string; model?: string; enabled?: boolean; apiKey?: string; clearKey?: boolean },
  ): Promise<AiSettingsView> {
    if (dto.provider && !SUPPORTED_PROVIDERS.includes(dto.provider as (typeof SUPPORTED_PROVIDERS)[number])) {
      throw new BadRequestException(`Provedor não suportado: ${dto.provider}`);
    }
    const existing = await this.prisma.aiSetting.findUnique({ where: { organizationId } });
    const data: Record<string, unknown> = { updatedByUserId: userId };
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.model !== undefined) data.model = dto.model;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.clearKey) {
      data.encryptedApiKey = null;
      data.enabled = false;
    } else if (dto.apiKey && dto.apiKey.trim()) {
      // A chave é cifrada com AES-256-GCM e nunca é retornada ao frontend.
      data.encryptedApiKey = encryptSecret(dto.apiKey.trim(), this.encKey());
    }
    await this.prisma.aiSetting.upsert({
      where: { organizationId },
      create: {
        organizationId,
        provider: (data.provider as string) ?? 'anthropic',
        model: (data.model as string) ?? DEFAULT_MODELS.anthropic,
        enabled: (data.enabled as boolean) ?? false,
        encryptedApiKey: (data.encryptedApiKey as string) ?? null,
        updatedByUserId: userId,
      },
      update: data,
    });
    await this.audit.record({
      organizationId,
      userId,
      action: AuditAction.AI_SETTING_UPDATE,
      entityType: 'AiSetting',
      entityId: organizationId,
      metadata: {
        provider: data.provider ?? existing?.provider,
        model: data.model ?? existing?.model,
        enabled: data.enabled ?? existing?.enabled,
        keyChanged: !!dto.apiKey || !!dto.clearKey,
      },
    });
    return this.getSettings(organizationId);
  }

  /** Teste de conectividade real com o provedor (não persiste análise). */
  async testConnection(organizationId: string): Promise<{ ok: boolean; message: string }> {
    const cfg = await this.loadRuntime(organizationId);
    try {
      const provider = buildProvider(cfg.provider);
      const res = await provider.complete(
        {
          model: cfg.model,
          system: 'Responda apenas com a palavra OK.',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 5,
          temperature: 0,
        },
        cfg.apiKey,
      );
      return { ok: true, message: `Conexão OK (${cfg.provider}/${cfg.model}); resposta: ${res.text.slice(0, 40)}` };
    } catch (e) {
      const msg = e instanceof AIProviderError ? e.message : (e as Error).message;
      return { ok: false, message: msg };
    }
  }

  private async loadRuntime(organizationId: string): Promise<{ provider: string; model: string; apiKey: string }> {
    const s = await this.prisma.aiSetting.findUnique({ where: { organizationId } });
    if (!s || !s.enabled) throw new BadRequestException('IA não está habilitada. Configure em Inteligência › Configuração.');
    if (!s.encryptedApiKey) throw new BadRequestException('Nenhuma credencial de IA cadastrada.');
    let apiKey: string;
    try {
      apiKey = decryptSecret(s.encryptedApiKey, this.encKey());
    } catch {
      throw new BadRequestException('Falha ao decifrar a credencial de IA. Recadastre a chave.');
    }
    return { provider: s.provider, model: s.model, apiKey };
  }

  // -------------------------------------------------------------- Evidência
  /**
   * Monta o pacote de EVIDÊNCIAS (agregados determinísticos) para a IA.
   * Contém apenas SKUs, contagens, valores, status e motivos — SEM PII
   * (nome/endereço de comprador). Textos livres são sanitizados (§61).
   */
  async buildEvidence(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const [overview, exposure, findings, coverage] = await Promise.all([
      this.postSale.overview(organizationId, marketplaceAccountId, p),
      this.postSale.exposure(organizationId, marketplaceAccountId, p),
      this.postSale.findings(organizationId, marketplaceAccountId, p),
      this.postSale.coverage(organizationId, marketplaceAccountId),
    ]);
    return {
      period: { from: p.from?.toISOString() ?? null, to: p.to?.toISOString() ?? null },
      totals: {
        occurrences: overview.totalOccurrences,
        distinctOrders: overview.distinctOrders,
        byType: overview.byType,
        unlinkedItems: overview.unlinkedItems,
      },
      exposure: {
        requested: exposure.requested,
        confirmedLoss: exposure.confirmedLoss,
        atRisk: exposure.atRisk,
        recovered: exposure.recovered,
        cancelled: exposure.cancelled,
        methodology: exposure.methodology,
      },
      topSkus: findings.topSkus.map((s) => ({
        sku: sanitizeUntrusted(s.sku, 60),
        product: sanitizeUntrusted(s.product, 120),
        occurrences: s.occ,
        confirmedLoss: Math.round(s.loss * 100) / 100,
      })),
      topReasons: findings.topReasons.map((r) => ({ reason: sanitizeUntrusted(r.reason, 120), count: r.count })),
      deterministicFindings: findings.findings.map((f) => ({
        type: f.type,
        title: sanitizeUntrusted(f.title, 160),
        confidence: f.confidence,
      })),
      dataHealth: coverage.dataHealth,
      sampleSize: findings.sampleSize,
    };
  }

  private scopeKey(functionKey: string, version: string, provider: string, model: string, scope: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify({ functionKey, version, provider, model, scope }))
      .digest('hex')
      .slice(0, 32);
  }

  /** Extrai o primeiro objeto JSON de um texto (tolera cercas de código). */
  private parseJson(text: string): unknown {
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
    return JSON.parse(t);
  }

  // --------------------------------------------------------------- Análise
  async analyze(
    organizationId: string,
    userId: string,
    marketplaceAccountId: string,
    functionKey: string,
    p: PeriodFilter,
    opts: { force?: boolean; question?: string } = {},
  ) {
    const fn = getFunction(functionKey);
    const cfg = await this.loadRuntime(organizationId);
    const evidence = await this.buildEvidence(organizationId, marketplaceAccountId, p);
    const scope = { period: evidence.period, sampleSize: evidence.sampleSize, question: opts.question ?? null };
    const key = this.scopeKey(fn.key, fn.version, cfg.provider, cfg.model, scope);

    // Cache (§54): reaproveita resultado OK idêntico — exceto chat e force.
    if (!opts.force && fn.key !== 'chat') {
      const cached = await this.prisma.aiAnalysis.findFirst({
        where: { organizationId, marketplaceAccountId, functionKey: fn.key, scopeKey: key, status: 'OK' },
        orderBy: { createdAt: 'desc' },
      });
      if (cached) {
        return { cached: true, id: cached.id, functionKey: fn.key, promptVersion: fn.version, output: cached.output, evidences: cached.evidences, createdAt: cached.createdAt };
      }
    }

    const provider = buildProvider(cfg.provider);
    const baseReq = {
      model: cfg.model,
      system: fn.system(),
      messages: [{ role: 'user' as const, content: fn.user(evidence, opts.question) }],
      maxTokens: 1800,
      temperature: 0.2,
      json: true,
    };

    let raw: string | null = null;
    let parsed: unknown = null;
    let errors: string[] = [];
    let tokensInput = 0;
    let tokensOutput = 0;

    try {
      // Até 2 tentativas: retriável (429/5xx) OU JSON inválido (com correção).
      for (let attempt = 0; attempt < 2; attempt++) {
        const messages = [...baseReq.messages];
        if (attempt === 1 && errors.length) {
          messages.push({ role: 'user' as const, content: `O JSON anterior era inválido: ${errors.join('; ')}. Responda APENAS com o JSON válido no formato pedido.` });
        }
        try {
          const res = await provider.complete({ ...baseReq, messages }, cfg.apiKey);
          raw = res.text;
          tokensInput = res.tokensInput;
          tokensOutput = res.tokensOutput;
        } catch (e) {
          if (e instanceof AIProviderError && e.retriable && attempt === 0) continue;
          throw e;
        }
        try {
          parsed = this.parseJson(raw);
        } catch {
          errors = ['resposta não é JSON'];
          continue;
        }
        errors = fn.validate(parsed);
        if (errors.length === 0) break;
      }
    } catch (e) {
      const msg = e instanceof AIProviderError ? e.message : (e as Error).message;
      const rec = await this.prisma.aiAnalysis.create({
        data: {
          organizationId, marketplaceAccountId, functionKey: fn.key, promptVersion: fn.version,
          provider: cfg.provider, model: cfg.model, scopeKey: key,
          input: scope as object, status: 'ERROR', errorMessage: msg.slice(0, 500), createdByUserId: userId,
        },
      });
      throw new BadRequestException({ message: `Falha na chamada de IA: ${msg}`, analysisId: rec.id });
    }

    const status = errors.length === 0 ? 'OK' : 'INVALID';
    const rec = await this.prisma.aiAnalysis.create({
      data: {
        organizationId, marketplaceAccountId, functionKey: fn.key, promptVersion: fn.version,
        provider: cfg.provider, model: cfg.model, scopeKey: key,
        input: scope as object,
        output: (parsed ?? { raw }) as object,
        evidences: evidence as object,
        status,
        tokensInput, tokensOutput,
        errorMessage: errors.length ? `Saída inválida: ${errors.join('; ')}` : null,
        createdByUserId: userId,
      },
    });
    await this.audit.record({
      organizationId, userId, action: AuditAction.AI_ANALYZE,
      entityType: 'AiAnalysis', entityId: rec.id,
      metadata: { functionKey: fn.key, promptVersion: fn.version, provider: cfg.provider, model: cfg.model, status, tokensInput, tokensOutput },
    });
    return {
      cached: false, id: rec.id, functionKey: fn.key, promptVersion: fn.version,
      status, output: parsed, evidences: evidence, tokensInput, tokensOutput, createdAt: rec.createdAt,
      ...(status === 'INVALID' ? { warning: `Saída não passou na validação: ${errors.join('; ')}` } : {}),
    };
  }

  async history(organizationId: string, marketplaceAccountId: string, functionKey?: string) {
    return this.prisma.aiAnalysis.findMany({
      where: { organizationId, marketplaceAccountId, ...(functionKey ? { functionKey } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, functionKey: true, promptVersion: true, provider: true, model: true,
        status: true, tokensInput: true, tokensOutput: true, createdAt: true, output: true,
      },
    });
  }
}
