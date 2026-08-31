# v1.0.3 — Família, custo do produto e fator de custo

Hotfix de produção baseado integralmente na release v1.0.2 (`c64f0ccc0c3d7a7c26a7d3244da2754d45491174`).

## Correções

- Mantém livre o vínculo de qualquer variação/SKU com qualquer família, inclusive quando o mesmo texto de SKU aparece em vários anúncios.
- Quando várias ocorrências do mesmo SKU têm somente uma família efetivamente escolhida, ocorrências ainda sem família não anulam o custo já cadastrado.
- Quando o usuário escolhe manualmente a família de um SKU na auditoria de Pedidos, essa escolha passa a prevalecer de fato em todos os pedidos da operação.
- Invalida imediatamente o cache financeiro dos pedidos depois de editar família ou custo, evitando custo pendente até uma troca de tela.
- Na primeira configuração do Fator de Custo, sugere como início de vigência a data do pedido mais antigo da operação, para não excluir silenciosamente a base já importada.

## Preservação das regras

- O custo continua tendo a família como única fonte; não foi criado cálculo financeiro paralelo.
- SKUs já classificados em famílias diferentes continuam exigindo desambiguação, para impedir aplicação arbitrária de custo.
- Snapshots de dias fechados permanecem imutáveis.
- Nenhuma regra de receita, taxa, comissão, custo industrial ou rentabilidade foi alterada.
- A V1 certificada e a tag `v1.0.0-certified` não foram modificadas.
