# Delivery — cadastro CPF (issue #62)
Entrega parcial em branch de homologação. Não ativar em produção.
 
## Implementado
- Reutiliza sessão Neon Auth por OTP de e-mail existente e endereços salvos; CPF não é senha nem comprova titularidade. WhatsApp permanece não verificado.
- CPF normalizado, dígitos verificadores, HMAC com segredo exclusivo e índice único. Apenas dois dígitos finais retornam à própria conta. Vínculo imutável pelo cliente; correção administrativa ainda precisa de fluxo seguro.
- DELIVERY_ACCOUNT_REQUIRED=true habilita cadastro CPF, valida sessão e perfil na API de intenção delivery e desabilita a rota legada de delivery. Pedidos novos incluem account_subject no insert e no digest de idempotência. Não expõe CPF ao Telegram.
- Sem flag, fluxo anterior permanece. Presencial e retirada não exigem CPF.
 
## Gate antes de ativar
1. Confirmar migration anterior de dp.customer_accounts e tipo de subject; executar 100_customer_cpf_delivery.sql exclusivamente em Neon de homologação com backup e dados fictícios. Não rodar novamente sem revisar constraint existente.
2. Configurar CUSTOMER_CPF_HMAC_KEY (32 bytes aleatórios em hex, exclusivo, manter em cofre; não rotacionar sem plano). Configurar CUSTOMER_ACCOUNTS_ENABLED e autenticação separada, Turnstile e origem HML. Nunca expor valores.
3. Validar npm ci / npm test, sessão real HML, CPF duplicado, concorrência, troca de conta, autorização, idempotência e falhas de banco. Não usar chat ou credenciais reais. Não ativar flag sem persistência e horário em modo obrigatório.
4. Concluir integração do histórico e busca administrativa pelo identificador da conta, desvincular agregações por telefone não verificado, definir correção/recuperação do CPF, privacidade e base legal; implementar autenticação do telefone se requerida. CPF não prova identidade nem propriedade da linha.
5. Confirmar comportamento de sessão no checkout e fallback manual. Rever APIs públicas de pedidos e estado do site. Homologar com usuário.
6. Aprovação explícita de merge/deploy. Rollback da flag para false (retorna fluxo legado), preservar registros e migration aditiva, não remover dados.
 
## Pendências da issue #62
Backoffice simplificado, canal presencial separado, mapa privado, desligamento do cupom térmico, rejeição Telegram, filtros, histórico próprio e ajustes de horários. Horários e aceite Telegram já possuem componentes legados, mas não estão homologados para o escopo novo. Não declarar conclusão.
