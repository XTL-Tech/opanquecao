'use strict';
// Validação em Chromium real, sem criar pedidos nem acionar a loja.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=process.cwd();
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/catalog'){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(fs.readFileSync(path.join(root,'cardapio.json')));return;
    }
    if(url.pathname==='/api/store-status'){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({enabled:false,open:true}));return;
    }
    const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const filename=path.resolve(root,'.'+pathname);
    if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(filename,(error,data)=>{
        if(error){res.writeHead(404);res.end();return;}
        res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream'});
        res.end(data);
    });
});
const chrome=process.env.CHROME_BIN ||
    ['google-chrome','google-chrome-stable','chromium','chromium-browser']
        .find(x=>spawnSync('which',[x],{stdio:'ignore'}).status===0);
assert.ok(chrome,'Chromium não encontrado para testar responsividade');
class CDP {
    constructor(socket){
        this.socket=socket;this.id=0;this.calls=new Map();
        socket.addEventListener('message',event=>{
            const message=JSON.parse(event.data);
            if(!message.id||!this.calls.has(message.id))return;
            const {resolve,reject}=this.calls.get(message.id);
            this.calls.delete(message.id);
            if(message.error)reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result||{});
        });
    }
    call(method,params={}){
        const id=++this.id;
        return new Promise((resolve,reject)=>{
            this.calls.set(id,{resolve,reject});
            this.socket.send(JSON.stringify({id,method,params}));
        });
    }
    async eval(expression){
        const result=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
        if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
        return result.result?.value;
    }
}
async function waitFor(check,timeout=20000){
    const until=Date.now()+timeout;
    while(Date.now()<until){if(await check())return;await sleep(150);}
    throw new Error('Tempo esgotado no navegador');
}
function viewportMetrics(){
    const rect=(name,el)=>{
        const r=el.getBoundingClientRect();
        return {name,left:r.left,right:r.right,top:r.top,bottom:r.bottom};
    };
    const cols=el=>getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
    return {
        viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        cards:document.querySelectorAll('.category-card').length,
        home:!document.querySelector('#categoryHome').hidden,
        visibleSections:document.querySelectorAll('.category-section:not([hidden])').length,
        categoryColumns:cols(document.querySelector('#categoryCards')),
        productColumns:cols(document.querySelector('#panquecas-salgadas .menu-grid')),
        productStyle:getComputedStyle(document.querySelector('#panquecas-salgadas .menu-item')).display,
        productImage:(() => { const r=document.querySelector('#panquecas-salgadas .menu-item .item-photo img').getBoundingClientRect();return {width:r.width,height:r.height}; })(),
        whatsapp:rect('whatsapp',document.querySelector('a.whatsapp-float')),
        cart:rect('cart',document.getElementById('openCart')),
        tabs:rect('tabs',document.querySelector('.site-tabs'))
    };
}
function productModalMetrics(){
    const d=document.getElementById('productDialog').getBoundingClientRect();
    const image=document.querySelector('#productDialogContent > .item-photo img')?.getBoundingClientRect();
    return {left:d.left,right:d.right,top:d.top,bottom:d.bottom,imageHeight:image?.height||0};
}
function cartModalMetrics(){
    const d=document.getElementById('cartDialog').getBoundingClientRect();
    return {left:d.left,right:d.right,top:d.top,bottom:d.bottom};
}
function productCardLayoutMetrics() {
    const cards = [...document.querySelectorAll('.category-section:not([hidden]) .menu-item')];
    return cards.map(card => {
        const rect = el => {
            const r = el?.getBoundingClientRect();
            return r ? {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height} : null;
        };
        return {
            name: card.dataset.product,
            card: rect(card),
            copy: rect(card.querySelector('.item-copy')),
            title: rect(card.querySelector('.item-title')),
            details: rect(card.querySelector('.details-link')),
            footer: rect(card.querySelector('.item-footer')),
            action: rect(card.querySelector('.card-primary-action')),
            actionCount: card.querySelectorAll(':scope > .card-primary-action').length,
            detailsCount: card.querySelectorAll('.details-link').length
        };
    });
}
function assertCardLayout(cards, width) {
    assert.ok(cards.length>0,'Sem produtos para validar o layout '+width);
    for(const item of cards){
        const epsilon = 2;
        assert.equal(item.actionCount,1,'O produto deve ter uma só ação principal: '+item.name);
        for(const key of ['copy','title','footer','action']){
            assert.ok(item[key] && item[key].width>0 && item[key].height>0,
                'Elemento sem área visual ('+key+'): '+item.name+' em '+width);
            assert.ok(item[key].left>=item.card.left-epsilon &&
                item[key].right<=item.card.right+epsilon,
                'Elemento vaza horizontalmente do card ('+key+'): '+item.name+' em '+width);
        }
        assert.ok(item.title.bottom<=item.footer.top+epsilon,
            'Preço invade o nome do produto: '+item.name+' em '+width);
        assert.ok(item.copy.bottom<=item.footer.top+epsilon,
            'Descrição e preço sobrepostos: '+item.name+' em '+width);
        assert.ok(item.footer.bottom<=item.action.top+epsilon,
            'Botão sobreposto ao preço: '+item.name+' em '+width);
        assert.ok(item.action.bottom<=item.card.bottom+epsilon,
            'Botão excede a altura do card: '+item.name+' em '+width);
        assert.ok(item.action.height>=43,
            'Botão muito pequeno para toque: '+item.name+' em '+width);
        if(item.details){
            assert.equal(item.detailsCount,1);
            assert.ok(item.title.bottom<=item.details.top+epsilon,
                'Ver detalhes sobreposto ao título: '+item.name+' em '+width);
            assert.ok(item.details.bottom<=item.footer.top+epsilon,
                'Ver detalhes sobreposto ao preço: '+item.name+' em '+width);
        }
    }
}
// Auditoria real no Chromium: clique em título, foto e CTA dos 83 cards.
function auditCardClickthrough(){
    const problems=[];
    let cardsChecked=0,photosChecked=0,consultations=0,categoriesChecked=0;
    const assert=(condition,message)=>{if(!condition)throw Error(message)};
    const dialog=document.getElementById('productDialog');
    for(const cat of window.menuCatalog.categorias){
        const route=document.querySelector('.category-card[href="#'+cat.id+'"]');
        assert(route,'Categoria ausente: '+cat.id);
        route.click();
        assert(!document.getElementById(cat.id).hidden,'Categoria não abriu: '+cat.id);
        categoriesChecked++;
        for(const card of document.querySelectorAll('#'+cat.id+' .menu-item')){
            const name=card.dataset.product,variant=card.dataset.option||'';
            const key=cat.id+'/'+name+'/'+variant;
            try{
                const item=cat.itens.find(x=>x.nome===name);
                assert(item,key+' não aparece no catálogo');
                const expected=cat.titulo+' · '+card.querySelector('.item-title').textContent;
                const consult=item.preco==='Consultar';
                const verify=(source)=>{
                    assert(dialog.open,key+': '+source+' não abriu ficha');
                    assert(document.getElementById('productDialogTitle').textContent===expected,
                        key+': '+source+' abriu outro produto');
                    const form=document.querySelector('#productDialogContent form.order-form');
                    const link=document.querySelector('#productDialogContent a.cart-whatsapp');
                    assert(consult ? !form&&!!link : !!form,
                        key+': '+source+' abriu ficha inválida');
                    if(consult)assert(new URL(link.href).searchParams.get('text').includes(name),
                        key+': link WhatsApp do produto incorreto');
                    dialog.close();
                };
                card.querySelector('.item-title').click();
                verify('título');
                const photo=card.querySelector('.item-photo img');
                if(photo){
                    photo.click();
                    verify('foto');
                    photosChecked++;
                }
                const action=card.querySelector(':scope > .card-primary-action');
                assert(action,key+' sem botão de ação');
                if(consult){
                    consultations++;
                    assert(!action.classList.contains('quick-add'),key+' consulta não pode ter + Adicionar');
                }
                if(!action.classList.contains('quick-add')){
                    action.click();
                    verify('botão');
                }
                cardsChecked++;
            }catch(e){
                problems.push(String(e?.message||e));
                if(dialog.open)dialog.close();
            }
        }
        document.querySelector('.category-toolbar > a').click();
    }
    return {cardsChecked,photosChecked,consultations,categoriesChecked,problems};
}

const expression=fn=>'('+fn.toString()+')()';
function within(rect,width){
    assert.ok(rect.left>=-2&&rect.right<=width+2,'Elemento fora da largura '+width+': '+JSON.stringify(rect));
}
(async()=>{
    let browser,socket;
    try{
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const port=server.address().port;
        const profile=fs.mkdtempSync(path.join(os.tmpdir(),'xtl-responsive-'));
        browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu',
            '--disable-extensions','--disable-background-networking','--no-first-run',
            '--remote-allow-origins=*','--remote-debugging-port=0',
            '--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
        const portFile=path.join(profile,'DevToolsActivePort');
        await waitFor(()=>fs.existsSync(portFile),15000);
        const chromePort=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);
        const targets=await(await fetch('http://127.0.0.1:'+chromePort+'/json/list')).json();
        const page=targets.find(x=>x.type==='page');
        assert.ok(page?.webSocketDebuggerUrl,'Nenhuma aba Chromium encontrada');
        socket=new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve,reject)=>{
            socket.addEventListener('open',resolve,{once:true});
            socket.addEventListener('error',reject,{once:true});
        });
        const cdp=new CDP(socket);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        await cdp.call('Page.addScriptToEvaluateOnNewDocument',{
            source:"try{localStorage.setItem('disk-panquecao-analytics-consent-v1','rejected')}catch{}"
        });
        await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
        await waitFor(()=>cdp.eval("Boolean(window.menuCatalog && document.querySelectorAll('.category-card').length===12 && window.storeOperationStatus)"));
        const target=path.join(root,'artifacts','responsive');
        fs.mkdirSync(target,{recursive:true});
        async function shot(filename){
            const {data}=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            fs.writeFileSync(path.join(target,filename+'.png'),Buffer.from(data,'base64'));
        }
        const sizes=[[320,720,1,1],[390,844,1,1],[600,900,2,2],
            [768,1024,2,2],[1024,768,3,2],[1440,900,4,4],[896,414,2,2]];
        for(const [width,height,categories,products] of sizes){
            await cdp.call('Emulation.setDeviceMetricsOverride',{
                width,height,deviceScaleFactor:1,mobile:width<900
            });
            await sleep(180);
            const home=await cdp.eval(expression(viewportMetrics));
            assert.equal(home.cards,12);
            assert.equal(home.home,true);
            assert.equal(home.visibleSections,0,'Home deve mostrar apenas categorias');
            assert.equal(home.categoryColumns,categories,'Categorias: '+width);
            assert.ok(home.scrollWidth<=width+2,'Rolagem horizontal na home: '+width+' '+home.scrollWidth);
            for(const rect of [home.whatsapp,home.cart,home.tabs])within(rect,width);
            assert.ok(home.whatsapp.right<=home.cart.left+1||
                home.cart.right<=home.whatsapp.left+1,'WhatsApp e carrinho se sobrepõem: '+width);
            if(width===390||width===768){await cdp.eval('window.scrollTo(0,0)');await sleep(90);await shot('home-'+width);}
            await cdp.eval("document.querySelector('.category-card[href=\"#panquecas-salgadas\"]').click()");
            await waitFor(()=>cdp.eval("document.querySelector('#categoryHome').hidden && document.querySelectorAll('.category-section:not([hidden])').length===1"),5000);
            const menu=await cdp.eval(expression(viewportMetrics));
            assert.equal(menu.productColumns,products,'Produtos: '+width);
            assert.ok(menu.scrollWidth<=width+2,'Rolagem horizontal no menu: '+width+' '+menu.scrollWidth);
            if(width<600)assert.equal(menu.productStyle,'grid','Produto móvel deve ser horizontal');
            assert.ok(menu.productImage.height <= menu.productImage.width*1.15,
                'Foto fora de proporção em '+width+': '+JSON.stringify(menu.productImage));
            assertCardLayout(await cdp.eval(expression(productCardLayoutMetrics)),width);
            // A categoria bebidas possui ações de adição direta, não duas colunas de botões.
            await cdp.eval("document.querySelector('.category-switcher a[href=\"#bebidas\"]').click()");
            await waitFor(()=>cdp.eval("document.querySelector('#bebidas:not([hidden])')!==null"),5000);
            assertCardLayout(await cdp.eval(expression(productCardLayoutMetrics)),width);
            const beverages=await cdp.eval(expression(productCardLayoutMetrics));
            assert.ok(beverages.some(item=>item.details && item.actionCount===1),'Bebidas simples com link de detalhes e um botão para adicionar');
            await cdp.eval("document.querySelector('.category-switcher a[href=\"#panquecas-salgadas\"]').click()");
            await waitFor(()=>cdp.eval("!document.getElementById('panquecas-salgadas').hidden"),5000);
            if([390,768,1440].includes(width))await shot('menu-'+width);
            await cdp.eval("document.querySelector('#panquecas-salgadas .product-details').click()");
            await waitFor(()=>cdp.eval("document.getElementById('productDialog').open && !!document.querySelector('#productDialogContent form.order-form')"),5000);
            const modal=await cdp.eval(expression(productModalMetrics));
            within(modal,width);
            assert.ok(modal.top>=-2&&modal.bottom<=height+2,'Janela de produto sai da altura: '+width);
            assert.ok(modal.imageHeight<=212,'Foto alta demais na janela: '+width);
            if(width===390){
                assert.equal(await cdp.eval("document.querySelectorAll('#productDialogContent .size-grid').length"),0,
                    'Ficha não deve mostrar preços duplicados');
                await shot('produto-390');
                await cdp.eval("document.querySelector('#productDialogContent [data-adjust=\"1\"]').click()");
                assert.equal(await cdp.eval("document.querySelector('#productDialogContent [name=quantity]').value"),'2');
                await cdp.eval("document.querySelector('#productDialogContent .order-primary').click()");
                await waitFor(()=>cdp.eval("!document.getElementById('productDialog').open && document.querySelectorAll('#cartLines .cart-line').length > 0"),5000);
            }
            await cdp.eval("document.getElementById('productDialog').close();document.querySelector('.category-toolbar > a').click()");
            await waitFor(()=>cdp.eval("!document.getElementById('categoryHome').hidden"),5000);
            await cdp.eval("document.getElementById('openCart').click()");
            const cart=await cdp.eval(expression(cartModalMetrics));
            within(cart,width);
            assert.ok(cart.top>=-2&&cart.bottom<=height+2,'Carrinho sai da altura: '+width);
            if(width===390){
                assert.equal(await cdp.eval("document.querySelector('#cartLines .cart-line') !== null"),true);
                assert.equal(await cdp.eval("document.getElementById('checkout').hidden"),true);
                await shot('carrinho-390');
                await cdp.eval("document.getElementById('startCheckout').click()");
                assert.equal(await cdp.eval("document.getElementById('checkout').hidden"),false);
                assert.equal(await cdp.eval("document.querySelectorAll('#checkout [required]').length"),6);
                assert.equal(await cdp.eval("document.getElementById('deliveryFields').hidden"),false);
                assert.equal(await cdp.eval("document.getElementById('deliveryLocationPreview').hidden"),true,
                    'Não consultar GPS sem permissão');
                await shot('contato-390');
                await cdp.eval("document.getElementById('deliveryCity').value='Nova Hartz';document.getElementById('deliveryCity').dispatchEvent(new Event('change',{bubbles:true}))");
                await waitFor(()=>cdp.eval("document.getElementById('deliveryNeighborhood').options.length > 5"),5000);
                assert.equal(await cdp.eval("!!document.querySelector('#deliveryNeighborhood option[value=\"Centro\"]')"),true);
                await shot('endereco-390');
                await cdp.eval("document.querySelector('input[name=fulfillmentType][value=pickup]').click()");
                assert.equal(await cdp.eval("document.getElementById('deliveryFields').hidden"),true);
                await cdp.eval("document.querySelector('input[name=fulfillmentType][value=table]').click()");
                assert.equal(await cdp.eval("document.getElementById('tableIdentifier').required"),true);
                await cdp.eval("document.querySelector('input[name=fulfillmentType][value=delivery]').click()");
                assert.equal(await cdp.eval("document.getElementById('deliveryFields').hidden"),false);
                await cdp.eval("document.getElementById('cartBack').click()");
                assert.equal(await cdp.eval("document.getElementById('checkout').hidden"),true);
            }
            await cdp.eval("document.getElementById('cartDialog').close()");
            console.log('PASS '+width+'x'+height+' | '+categories+' categorias / '+products+' produtos por linha');
        }
        for(const width of [390,1440]){
            await cdp.call('Emulation.setDeviceMetricsOverride',{
                width,height:width===390?844:900,deviceScaleFactor:1,mobile:width<900
            });
            const audit=await cdp.eval(expression(auditCardClickthrough));
            assert.equal(audit.categoriesChecked,12,'Categorias não verificadas no Chromium '+width);
            assert.equal(audit.cardsChecked,83,
                'Nem todos os 83 cards abriram no Chromium '+width+': '+JSON.stringify(audit));
            assert.equal(audit.consultations,2,'Consulta de produtos com preço indisponível '+width);
            assert.deepEqual(audit.problems,[],'Falhas por item no Chromium '+width);
            console.log('PASS auditoria Chromium '+width+': '+audit.cardsChecked+
                ' cards, '+audit.photosChecked+' fotos, '+audit.consultations+' consultas.');
        }
        console.log('PASS responsividade em Chromium real, sem pedido enviado.');
    }finally{
        try{socket?.close()}catch{}
        if(browser)browser.kill('SIGKILL');
        await new Promise(resolve=>server.close(resolve));
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
