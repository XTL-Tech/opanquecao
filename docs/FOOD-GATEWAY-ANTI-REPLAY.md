# XTL Food — Proteção contra reutilização de requisições

Cada chamada Vercel → Supabase Edge recebe nonce aleatório de 128 bits no cabeçalho x-xtl-food-nonce.
A assinatura Ed25519 cobre timestamp, POST, rota, nonce e SHA-256 do corpo.
A função valida a assinatura e a janela de 45s, registra o hash SHA-256 do nonce por INSERT atômico e depois executa a operação Food.
Segunda utilização do mesmo nonce retorna HTTP 409 antes de qualquer consulta ao pedido.
Se o banco de nonces falhar, a função falha fechada (503). A tabela não contém dados pessoais.

Migration: xtl_food_gateway_nonce_once_v1. O índice por expires_at permite limpeza.
IMPORTANTE: a tabela ainda não se limpa automaticamente; antes de produção, configurar limpeza segura somente depois de expirados mais de 24h e monitorar consumo.
A janela de 45s evita replay, mas não substitui rate limit, auditoria e monitoramento.
Chaves Ed25519 continuam sem configuração no LAB; gateway real permanece fechado.
Nenhuma alteração nos sistemas em produção ou no bot comercial foi autorizada.
