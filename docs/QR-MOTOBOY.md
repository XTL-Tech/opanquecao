# QR Code para navegação do motoboy — Cupom térmico

## Fluxo
Quando o comprador, **somente na entrega**, usa "Usar minha localização atual" e permite a geolocalização do navegador, o servidor recebe latitude e longitude validadas junto com o pré-pedido. O cupom PDF imprime:
- GPS em texto (alternativa caso o QR não possa ser lido);
- código QR com link HTTPS para **direções de carro no Google Maps**, com a localização autorizada como destino;
- o endereço informado continua sendo mostrado; o GPS não substitui a conferência de rua, número e bairro.

O QR não aparece em retirada, consumo no local, sem permissão do cliente ou com coordenadas inválidas.

## Privacidade e segurança
- O QR é gerado **dentro da função de pedido**, sem API externa, usando encoder de código aberto com licença MIT versionada no repositório.
- O link de navegação apenas sai do papel quando alguém escaneia o cupom. O navegador do entregador pode enviar o destino ao Google Maps ao abrir o link.
- O QR contém coordenadas aproximadas em 6 casas decimais, **não** nome, telefone, número do pedido, links administrativos ou tokens.
- Como o cupom contém dados pessoais, não o publique nem deixe exposto. Acesso é restrito à equipe/entregador autorizado; descarte protegido depois da finalidade da entrega.
- Nenhuma coordenada é registrada nos logs do pedido. Não incluir GPS em analytics ou URLs de rastreamento.
- Coordenadas representam o local autorizado pelo comprador, mas podem não coincidir com a entrada/portão; **conferir o endereço**.
- O cupom permanece um **pré-pedido pendente de confirmação**; o QR não aceita nem conclui pedidos.

## Impressão
O QR é um gráfico vetorial preto, centralizado, com margem branca de 4 módulos. Tamanho máximo de 35 mm, reduzido automaticamente para caber em 40 mm; preserva cupons de 58 mm e formato A4. O PDF é gerado sem mudar a fonte comercial dos produtos ou a integração Telegram.

## Encoder e licença
Arquivo: `lib/vendor/qrcode-generator.js`. Upstream MIT: https://github.com/kazuhikoarase/qrcode-generator (commit `83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8`); licença integral em `lib/vendor/qrcode-generator.LICENSE`. Sem dependências adicionais de runtime.

## Testes
```sh
npm ci
npm test
```
Os testes geram cupons PDF sintéticos em 40/58 mm e A4, validam o link de direção e verificam ausência do QR sem GPS. Homologar a leitura na **impressora térmica física de 58 mm**, em papel real, antes de habilitar na operação.
