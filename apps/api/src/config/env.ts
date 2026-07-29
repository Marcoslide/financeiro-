import { z } from 'zod';

/** Validação do ambiente na inicialização (falha rápido se faltar algo). */
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(1209600),
  ENCRYPTION_KEY: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3001),
  NEXT_PUBLIC_API_URL: z.string().optional(),
  // Bloco 2 — armazenamento dos arquivos brutos importados.
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(26214400), // 25 MiB
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}
