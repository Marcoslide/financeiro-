import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * e2e contra o Postgres real (seed de demonstração já aplicado).
 * Cobre: login, rota protegida sem token (401), VIEWER em escrita (403),
 * criar usuário como ADMIN e auditoria gravada.
 */
describe('API e2e (Bloco 1)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  async function login(email: string, password = 'Demo@12345') {
    const res = await http.post('/api/auth/login').send({ email, password });
    return res;
  }

  it('GET /api/health é público', async () => {
    const res = await http.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('login com admin retorna tokens e usuário', async () => {
    const res = await login('admin@demo.local');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('login com senha errada retorna 401', async () => {
    const res = await login('admin@demo.local', 'senha-errada');
    expect(res.status).toBe(401);
  });

  it('rota protegida sem token retorna 401', async () => {
    const res = await http.get('/api/users');
    expect(res.status).toBe(401);
  });

  it('VIEWER não pode criar usuário (403)', async () => {
    const viewer = await login('viewer@demo.local');
    const res = await http
      .post('/api/users')
      .set('Authorization', `Bearer ${viewer.body.accessToken}`)
      .send({ name: 'Bloqueado', email: `x${Date.now()}@demo.local`, password: 'Senha@123', role: 'VIEWER' });
    expect(res.status).toBe(403);
  });

  it('ADMIN cria usuário e a ação é auditada', async () => {
    const admin = await login('admin@demo.local');
    const token = admin.body.accessToken;
    const email = `novo${Date.now()}@demo.local`;

    const created = await http
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Novo Usuário', email, password: 'Senha@123', role: 'FINANCIAL' });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe(email);
    expect(created.body).not.toHaveProperty('passwordHash');

    const audit = await http.get('/api/audit-logs').set('Authorization', `Bearer ${token}`);
    expect(audit.status).toBe(200);
    const hasCreate = audit.body.some(
      (l: any) => l.action === 'USER_CREATE' && l.entityId === created.body.id,
    );
    expect(hasCreate).toBe(true);
  });

  it('refresh rotaciona o token', async () => {
    const admin = await login('admin@demo.local');
    const res = await http.post('/api/auth/refresh').send({ refreshToken: admin.body.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).not.toBe(admin.body.refreshToken);
  });
});
