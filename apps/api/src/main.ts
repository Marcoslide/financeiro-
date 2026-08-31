import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.use(cookieParser());
  app.use(compression());

  // Fase 10.2 (login/usuários/perfis): serve docs/ (o "Sistema Marketplace —
  // Líder" estático) no MESMO servidor/porta da API. Evita todo o problema de
  // cookie cross-origin em rede local sem HTTPS — a sessão vira same-origin
  // de verdade, sem precisar de SameSite=None+Secure (que exige HTTPS).
  // app.setGlobalPrefix('api') só afeta as rotas do Nest; os arquivos
  // estáticos continuam servidos na raiz, ex.: http://<ip>:3001/sistema-marketplace.html
  app.useStaticAssets(join(__dirname, '..', '..', '..', 'docs'), { maxAge: '1h', etag: true });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  // CORS_EXTRA_ORIGINS: lista separada por vírgula de origens adicionais
  // liberadas (ex.: um servidor estático próprio, ou o domínio de staging do
  // GitHub Pages) — além de localhost:3000 (apps/web) e da própria origem do
  // Nest (que nem passa por CORS, por ser same-origin com o static acima).
  const extraOrigins = (config.get<string>('CORS_EXTRA_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: [config.get<string>('NEXT_PUBLIC_API_URL') ?? 'http://localhost:3000', 'http://localhost:3000', ...extraOrigins],
    credentials: true,
  });

  const port = config.get<number>('API_PORT') ?? 3001;
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API ouvindo em http://localhost:${port}/api`);
  new Logger('Bootstrap').log(`Sistema Marketplace (estático) em http://localhost:${port}/sistema-marketplace.html`);
}

void bootstrap();
