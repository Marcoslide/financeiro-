# Capacidades por módulo — checklist de não regressão

Regra permanente do projeto: **desenvolvimento cumulativo**. Um módulo novo nunca
pode substituir ou empobrecer um módulo existente. O último `docs/sistema-marketplace.html`
deve sempre conter a versão acumulada mais completa de TODOS os módulos abaixo.

Antes de gerar uma nova versão unificada, confira este checklist e rode a verificação
de regressão (Playwright) importando os arquivos reais em cada módulo.

## PRODUTOS (completo)
- [x] Produto master → variações/SKUs (agrupado por ID do Produto Shopee)
- [x] SKU junto ao nome (master: SKU principal + ID Shopee; variação: SKU)
- [x] Abas internas: Produtos | Famílias | Importações (só "Produtos" no menu lateral)
- [x] KPIs clicáveis: Anúncios, Variações/SKUs, SKUs sem família, SKUs sem preço de fechamento
- [x] Busca em tempo real (título, master, SKU principal, variação, SKU, IDs) que ESCONDE não-correspondentes
- [x] Filtros combináveis: família, classificação, preço de fechamento, estoque, variações, status
- [x] Ordenação (nome, estoque, preço, variações, sem família 1º, sem fechamento 1º)
- [x] Filtros operam no NÍVEL do SKU (irmãos fora do filtro não entram)
- [x] Conjunto filtrado ÚNICO: visualização = contagem = seleção = ação em massa
- [x] Checkbox master/variação com estado indeterminado
- [x] Selecionar página / Selecionar todos os N do resultado
- [x] Barra de ação em massa (classificar família, preço de fechamento, ativar/inativar)
- [x] Classificar família: individual (inline), no master (aplica às variações em contexto) e em massa
- [x] Família no master pede confirmação antes de sobrescrever classificações diferentes
- [x] Preço Shopee (leitura) + Preço de Fechamento (editável) — colunas separadas
- [x] Edição inline por dropdown/input (Enter/Esc/Tab) — nunca `prompt()`
- [x] Preço de fechamento do master preenche as variações em contexto (com confirmação se houver exceções)
- [x] Custo pertence à família; custo herdado aparece na tabela; "custo não informado" quando ausente
- [x] Famílias: busca, nova família, nome, código, custo atual, SKUs vinculados, status, atualização, observações, histórico de custo
- [x] Criar família dentro do fluxo de classificação em massa (sem perder a seleção)
- [x] Importações: histórico (data, arquivo, processados, novos, atualizados, sem alteração, erros)
- [x] Importador compacto ("Atualizar catálogo Shopee")
- [x] Paginação real 25/50/100 (sem `slice(0,400)`)
- [x] Expandir/Recolher master (individual e em lote)
- [x] Reimportar mesma planilha não duplica; sincroniza nome/preço/estoque; preserva família, preço de fechamento e histórico de custo

## PEDIDOS (completo)
- [x] Importação idempotente (upsert): mesmo marketplace+conta+ID = mesmo pedido
- [x] Abas por status normalizado: Todos, Não pago, A enviar, Enviado, Concluído, Cancelado
- [x] Pedido ≠ Item; multi-item com financeiro do pedido contado uma vez
- [x] Busca (ID, SKU, produto, rastreamento), ordenação, paginação
- [x] Dashboard (venda, ticket, unidades, taxas, custo, resultado, margem, status)
- [x] Detalhe: cards financeiros, itens (custo/rateio/lucro), composição financeira, logística/cliente, devoluções vinculadas, histórico
- [x] Integração Produtos: SKU → família → custo (snapshot) → lucro estimado
- [x] Integração Devoluções: indicador por ID do pedido
- [x] Custo ausente nunca vira zero (SKU não vinculado / custo não cadastrado → lucro pendente)

## PÓS-VENDA / DEVOLUÇÃO
- [x] Importação dos 3 relatórios (devoluções, cancelamentos, falhas), idempotente
- [x] Exposição financeira: solicitado ≠ prejuízo (confirmado/risco/recuperado/cancelado)
- [x] Ocorrência ≠ Pedido ≠ Item; multi-SKU conta valor uma vez
- [x] Top SKUs por ocorrência; vínculo com pedido
- [x] (Backend) Ficha operacional editável: status interno, responsável, causa, responsabilidade, mercadoria, disputa, eventos financeiros, timeline, impacto líquido determinístico

## DASHBOARD
- [x] Panorama vendas + pós-venda; cards; importações recentes; cruzamentos entre módulos

## INTELIGÊNCIA
- [x] Chat com Preview de evidências determinísticas ao lado
- [x] Respostas locais com citações; a IA nunca inventa números nem calcula dinheiro
- [x] (Backend) Provedor real (Anthropic/OpenAI), credencial cifrada no servidor, nunca no navegador

## Aceite de não regressão
O HTML unificado só é considerado válido quando contém SIMULTANEAMENTE, em suas
últimas versões: Dashboard + Produtos COMPLETO + Pedidos COMPLETO + Pós-venda + Inteligência.
