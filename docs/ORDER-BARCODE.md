# Código de barras para leitura futura no aplicativo — XTL Food

O topo de cada **pré-pedido** impresso agora exibe:
- ID atual do pedido em texto, ex.: `#a1b2c3d4`;
- código de barras 1D **Code 128 — conjunto B** codificando exatamente `a1b2c3d4`;
- linha `ID PARA APP: a1b2c3d4` como fallback legível.

Abrange entrega, retirada e consumo no local, com ou sem GPS. O QR Code de rotas permanece **somente na entrega que recebeu localização autorizada**. Não há links externos, nomes, números de telefone ou dados do cliente no código de barras. O PDF é desenhado em vetores (barras pretas, fundo branco) com zonas de silêncio de 10 módulos em ambos os lados; adapta-se a bobinas 40 mm e 58 mm e também A4.

## Contrato para o futuro aplicativo
- Simbologia: **Code 128-B**, sem FNC1 nem prefixos. A cadeia lida deve ser tratada como referência opaca e preservada exatamente, inclusive letras minúsculas.
- O ID de curto formato atual tem **8 caracteres** extraídos de UUID. Ele **não é garantia de unicidade global**; até existir ID durável, o aplicativo deve consultar `(identificador da loja, ID impresso)`, detectar duplicidades e verificar permissões antes de exibir detalhes.
- Para produção com histórico persistente, criar chave primária UUID completa no backend e vínculo com o código público antigo; **não substituir IDs atuais sem migração compatível**.
- A leitura do código **não comprova entrega, pagamento, propriedade nem autorização**. O app deve autenticar entregador e consultar API autorizada para obter informações.

## Privacidade e operacional
O código de barras é gerado **localmente** no servidor do Panquecão com padrões públicos Code 128 do projeto JsBarcode (MIT; arquivo da licença em `lib/barcode-code128.LICENSE`). Nenhuma API de terceiros para renderização. Não fazer upload de fotos do cupom em serviços públicos.
A leitura com scanner físico e teste com cupom de verdade 58 mm continuam necessários antes de homologar a integração do aplicativo; a suíte CI verifica geração de PDF, largura, conteúdo matemático e compatibilidade com QR GPS, mas não simula a ótica de um scanner.

## Testes
```sh
npm ci
npm test
```
