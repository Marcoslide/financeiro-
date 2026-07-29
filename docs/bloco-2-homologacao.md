# Bloco 2.1 — Homologação com arquivos reais

O Bloco 2 está **aprovado tecnicamente**, mas **só será considerado concluído**
depois que os **seus arquivos reais da Shopee** entrarem corretamente — sem perda
de dados, com deduplicação e reimportação validadas. Este guia mostra como fazer
essa homologação e como reportar qualquer divergência (que será corrigida no
próprio Bloco 2, antes do Bloco 3).

> Os arquivos reais **não** estão no repositório (contêm dados pessoais). Por isso
> a homologação roda **na sua máquina**, com os arquivos que você já tem. Nada é
> enviado para fora.

---

## Passo 0 — HTML de teste (zero instalação, offline)

O jeito mais rápido de conferir seus arquivos: abra **`docs/homologacao.html`** no
navegador (duplo clique) e **arraste os arquivos reais**. Ele roda **o mesmo motor
de leitura/detecção do sistema** (o código do importador foi empacotado para o
navegador) e mostra, por arquivo: tipo detectado + confiança, formato real,
**linha do cabeçalho**, colunas (e o esperado), prévia, contagens e **hash**.

- **Privacidade:** tudo acontece no seu navegador — **nada é enviado para a
  internet**. Pode usar os arquivos reais (com dados pessoais) com segurança.
- Solte o **mesmo arquivo duas vezes** para ver a **deduplicação** (0 importadas
  na 2ª vez). Solte dois períodos que se sobrepõem para ver a interseção duplicada.
- É um **pré-check de leitura**. A homologação definitiva continua sendo a
  importação pela **Central do sistema real** (Passo 2), que persiste e gera o lote.

Para regerar o HTML após mudanças no importador: `pnpm --filter @financeiro/api build:homolog`.

---

## Passo 1 — Pré-check via terminal (sem banco, em segundos)

Antes de subir o sistema, rode o harness de leitura sobre a pasta com seus arquivos.
Ele usa o **mesmo** pipeline da importação e revela problemas de leitura na hora.

```bash
pnpm install
pnpm --filter @financeiro/shared build
# aponte para a pasta com os SEUS relatórios reais (use caminho absoluto):
pnpm --filter @financeiro/api homologar -- /caminho/para/seus-arquivos
```

Saída no terminal (uma linha por arquivo) e um relatório em
`/caminho/para/seus-arquivos/homologacao-resultado.md` com, para cada arquivo:
formato real, **tipo detectado + confiança**, aba, **linha do cabeçalho**, colunas
(e o esperado pela inspeção), linhas físicas/dados, **linhas com erro de parsing**,
período e **hash**.

**O que observar:**
- Cada arquivo deve ser identificado com o **tipo correto**.
- Cabeçalho na linha certa (Carteira ≈ 18, Acelera ≈ 6, os demais 1).
- Número de **colunas** próximo do esperado (Pedidos 64, Cancelamentos 60,
  Falha 59, Devoluções 46, Carteira 9, Acelera 15, Comissão 41, Performance 11).
- **Linhas com erro = 0** (ou erros justificados, ex.: linha de total no rodapé).

> Se algum tipo vier errado, cabeçalho não for encontrado, faltarem colunas ou
> houver erros de parsing → **me envie o `homologacao-resultado.md`**. Eu corrijo o
> importador no Bloco 2.

---

## Passo 2 — Homologação definitiva (na tela real)

```bash
cp .env.example .env                      # ajuste DATABASE_URL se preciso
docker compose up -d                      # Postgres (ou use um Postgres local)
pnpm --filter @financeiro/database generate
pnpm --filter @financeiro/database migrate
pnpm --filter @financeiro/database seed
pnpm dev                                  # API:3001 + Web:3000
```

Entre em **http://localhost:3000** com `admin@demo.local` / `Demo@12345`, menu
**Importações**. Importe **um por um**, nesta ordem sugerida:

1. Pedidos · 2. Carteira · 3. Acelera · 4. Afiliados (Comissão e Performance) ·
5. Cancelamentos · 6. Falha na entrega · 7. Devoluções.

Para **cada** arquivo, confira na tela:

| Verificação | Onde |
|---|---|
| Cabeçalho encontrado (linha certa) | prévia (etapa 2) e detalhe do lote |
| Tipo detectado / confiança | prévia — **corrija manualmente se necessário** |
| Colunas e prévia das primeiras linhas | prévia (etapa 2) |
| Alertas antes de confirmar | prévia (etapa 2) |
| Linhas físicas × linhas de dados | detalhe do lote |
| Importadas / válidas / com erro | resultado e detalhe do lote |
| Hash do arquivo e do lote | detalhe do lote |
| Linhas com erro/alerta consultáveis | detalhe do lote → filtros |

Depois, para provar a **idempotência**:

8. **Reimporte o mesmo arquivo** → deve dar **0 importadas** (tudo duplicado).
9. (Opcional) Renomeie um arquivo e importe → deve ser reconhecido como já
   importado (mesmo conteúdo).

### Dica sobre Cancelamentos × Falha na entrega × Pedidos
Esses três compartilham o layout. A detecção usa o **conteúdo** e, como desempate,
o **nome do arquivo** (`toship`, `cancelled`, `failed_delivery`). Se algum vier com
o tipo errado, basta **selecionar o tipo correto** na etapa 2 antes de confirmar.

---

## Passo 3 — Critério de "homologado"

O Bloco 2 estará **definitivamente concluído** quando, com os **arquivos reais**:
- os 7 relatórios entrarem com o **tipo, cabeçalho e colunas corretos**;
- **nenhuma linha for perdida** (linhas de dados = importadas + duplicadas +
  atualizadas + erros justificados);
- **reimportar não duplicar** (0 importadas na 2ª vez);
- linhas com erro/alerta ficarem **consultáveis** e não invalidarem o lote.

---

## Como reportar divergências

Me envie:
1. o `homologacao-resultado.md` gerado no Passo 1;
2. para o caso com problema: **qual** relatório, **o que** esperava e **o que**
   apareceu (tipo, cabeçalho, colunas, número de linhas, mensagem de erro);
3. se possível, o **nome do arquivo** e a **linha do cabeçalho** real.

Não precisa mandar o arquivo (dados pessoais). Com o `homologacao-resultado.md`
e a descrição eu consigo reproduzir com uma fixture equivalente e corrigir.
