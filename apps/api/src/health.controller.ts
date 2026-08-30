import { Controller, Get } from '@nestjs/common';
import { execSync } from 'child_process';
import { Public } from './common/decorators';

// Release engineering (go-live): resolve o commit rodando em produção sem depender de nenhum
// segredo — nunca lê .env, nunca expõe DATABASE_URL/JWT_*/ENCRYPTION_KEY. Prioridade: variável de
// ambiente explícita de deploy (funciona em qualquer host, mesmo sem .git presente) > `git
// rev-parse HEAD` local (funciona se o repositório git for enviado ao servidor) > 'unknown'.
function resolveCommit(): string {
  if (process.env.APP_COMMIT) return process.env.APP_COMMIT;
  try {
    return execSync('git rev-parse HEAD', { cwd: __dirname, timeout: 2000 }).toString().trim();
  } catch {
    return 'unknown';
  }
}
function resolveVersion(): string {
  return process.env.APP_RELEASE_VERSION || 'unknown';
}

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', service: 'financeiro-api', block: 'bloco-1' };
  }

  // Somente leitura, nunca expõe env/secrets — só o suficiente para provar, depois do deploy, qual
  // release/commit está de fato rodando (comparar com RELEASE_MANIFEST.json / tag Git).
  @Public()
  @Get('version')
  version() {
    return { status: 'ok', version: resolveVersion(), commit: resolveCommit() };
  }
}
