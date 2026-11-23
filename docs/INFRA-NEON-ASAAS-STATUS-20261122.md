# Infraestrutura Disk Panquecão — estado auditado (22/11/2026, BRT)

## Implementado e conferido

- Neon PostgreSQL exclusivo: projeto `disk-panquecao`, id `polished-brook-99513726`, região AWS São Paulo (`aws-sa-east-1`), plano Free.
- Branch padrão `production`, PostgreSQL 17, computação configurada para 0,25–0,5 CU. O plano não permitiu alterar `suspend_timeout_seconds`; **não afirmar que o scale-to-zero está ativo** sem verificar novamente no painel.
- Migração `neon/migrations/001_backoffice.sql` executada com 27 instruções em transação única.
- Catálogo seed validado: 12 categorias, 82 produtos; inicialmente 0 pedidos e 0 funcionários no banco.
- Neon Auth / Better Auth provisionado, cadastro público desabilitado, localhost desabilitado, domínio `https://opanquecao.vercel.app` adicionado à lista de origens confiáveis.
- Vercel `opanquecao`: variáveis `DATABASE_URL` (sensitive), `BACKOFFICE_PROVIDER=neon`, `NEON_AUTH_BASE_URL` e `BACKOFFICE_ENABLED=false` gravadas para **Production**; não são credenciais expostas ao Git.
- Deploy observado antes destas variáveis: `f279805708db87902df9cbcab4e24270ca2ba885`, estado READY. Variáveis adicionadas posteriormente exigem novo deploy para alcançar execução na aplicação.

## Bloqueios intencionais antes de habilitar

1. Cadastrar usuário gestor no Neon Auth via fluxo administrativo autorizado e vincular ao `dp.staff` com role `manager`. Não ativar inscrições públicas nem criar senhas compartilhadas.
2. Verificar com deploy Preview privado o fluxo real de login/logout, permissões, pedidos, busca e edição de preços. Garantir Preview não apontando para banco produtivo.
3. Configurar a conta **separada** do Asaas Sandbox e a chave `ASAAS_SANDBOX_API_KEY`, além do token `ASAAS_SANDBOX_WEBHOOK_TOKEN` e do webhook autenticado. Só então definir `ASAAS_SANDBOX_ENABLED=true`.
4. Testar criação de checkout fictício, confirmação por `CHECKOUT_PAID`, eventos duplicados, cancelamento e expiração. Verificar que sandbox não entra no caixa, pedidos reais ou Pixel.
5. Ativar `BACKOFFICE_ENABLED=true` e `CATALOG_SOURCE=neon` apenas após homologação; não ativar Asaas produção nem cobranças para pedidos reais neste ciclo.

## Otimização e riscos

- Preservar site estático HTML/CSS/JS, 82 produtos e imagens WebP; evitar dependências de frontend pesado.
- O driver HTTP do Neon, agregações SQL, limite de registros, lazy loading do catálogo e ausência de polling constante já estão no código.
- Medir CU-h, egress, tamanho de banco, número de invocações Vercel, latência P95 e erros antes de elevar limites ou criar caches adicionais.
- Não cachear dados privados nem resultados de autenticação; somente recursos estáticos e endpoints públicos de catálogo de curta duração.
- **Risco operacional:** no Free, backup/restauração e limites de uso precisam ser acompanhados. Validar restauração antes de dados reais e controlar retenção LGPD.

Estado: **infra provisionada; execução end-to-end e Asaas pendentes de credenciais/usuário administrativo**. Nenhuma cobrança real criada.

XTL — Feito para durar.
