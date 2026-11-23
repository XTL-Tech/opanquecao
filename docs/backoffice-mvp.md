# Backoffice Disk Panquecão — MVP 2026-11-22

STATUS: implementação de software, não ativação operacional. O Vercel do restaurante ainda não contém variáveis Supabase. Nas duas contas Supabase conectadas não existe projeto identificado como Disk Panquecão. Nenhum projeto novo foi criado ou banco alterado.

## Funcionalidades implementadas
- URL /backoffice/; demonstração em /backoffice/?demo=1 com dados FICTÍCIOS apenas na memória.
- Login Supabase Auth, cookies de sessão HttpOnly, Secure, SameSite=Strict; cada chamada verifica sessão, usuário e role da tabela restaurant_staff no servidor.
- Perfis manager e attendant. Attendant: clientes, aceite, status de pedido, pagamento recebido, caixa. Manager: tudo isso e alterações de preços.
- Estados: pending_customer -> awaiting_acceptance -> accepted -> completed -> delivered; cancelamentos não pagos antes de entregar.
- Clientes: cadastro/edição, telefone, observações internas, busca. Pedidos manuais simples por produto/tamanho, retirada/mesa/entrega. Opções com dois sabores devem ser montadas pelo cardápio público inicialmente.
- Pré-registro público, quando ativado: o servidor persiste cliente e pedido antes de Telegram/PDF, com requestId único e estado incerto sem repetição automática.
- Caixa: somente pedidos entregues E pagos, separados por dinheiro, Pix, crédito, débito e outros. Conferência do dinheiro físico e diferença. Fechamento diário atômico e congelado por trigger no banco, data local de São Paulo.
- Preços: manager edita campo preço, tamanho ou adicional de açaí; revisão otimista e histórico nativo do catálogo. Pedidos antigos mantêm preços já registrados.
- Fora do escopo inicial: cozinha, copa, motoboy, pagamento Asaas, emissão NFC-e, devoluções e controle de custos.

## Ativação necessária
1. Escolher uma organização Supabase e criar projeto separado dedicado ao Disk Panquecão, região São Paulo. Nunca usar projeto XTL Core, LinkSul ou Jarbas.
2. Aplicar migrations 202611170001, 002, 003, 004 e 202611220005 em ordem. As tabelas com PII ficam com RLS habilitado, sem permissões anon/authenticated.
3. Criar a primeira conta gestora individual em Supabase Auth. Copiar o UUID real do usuário e cadastrar em restaurant_staff com restaurant_id opanquecao e role manager. Não abrir auto-inscrição nem criar senha fictícia.
4. Na Vercel, configurar as variáveis SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY (SOMENTE backend), CATALOG_SOURCE=supabase e BACKOFFICE_ENABLED=true. Nunca colocar chaves no navegador/GitHub.
5. Validar login autorizado e rejeição de login sem role, RLS, criação de pedido real de TESTE autorizado, fluxo Telegram/PDF, aceite, fechamento, preço refletido no cardápio, concorrência, backup e política LGPD.
6. Criar contas atendentes individuais com role attendant. Revogar acesso por active=false no banco ou desativação no Auth.

## Operação e limitações
- Um pré-registro no Telegram não equivale a pedido aceito ou pagamento recebido.
- Pagamento é confirmado manualmente por atendente e não prova liquidação bancária; Purchase no Pixel não muda automaticamente.
- Histórico antigo apenas em Telegram/WhatsApp não é importado automaticamente.
- O valor de frete permanece a confirmar até o atendente defini-lo antes do aceite.
- Caixa diário é conferência operacional de recebimentos registrados, não contabilidade/fiscal.
- O envio de PDF para o Telegram ainda não aciona diretamente a impressora física.
- Os dados de clientes são privados; proteger e auditar o acesso ao Telegram e ao Supabase.
- Backoffice lista 250 pedidos recentes, 400 clientes, e apura até 1000 liquidações/dia; ampliar com paginação quando necessário.
- Após fechamento, pagamentos que tentem liquidar o dia já fechado são barrados no banco. Estornos e reconciliações posteriores exigem fluxo específico.

## Verificação
Execute npm ci, node tests/backoffice.cjs e npm test. CI usa mocks e dados fictícios, não acessa Telegram real, Supabase real nem dados pessoais da loja.

XTL — Feito para durar. SECURE > STABLE > SIMPLE > SCALABLE.
