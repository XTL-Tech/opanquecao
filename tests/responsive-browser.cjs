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
            if(width===390||width===768)await shot('home-'+width);
            await cdp.eval("document.querySelector('.category-card[href=\"#panquecas-salgadas\"]').click()");
            await waitFor(()=>cdp.eval("document.querySelector('#categoryHome').hidden && document.querySelectorAll('.category-section:not([hidden])').length===1"),5000);
            const menu=await cdp.eval(expression(viewportMetrics));
            assert.equal(menu.productColumns,products,'Produtos: '+width);
            assert.ok(menu.scrollWidth<=width+2,'Rolagem horizontal no menu: '+width+' '+menu.scrollWidth);
            if(width<600)assert.equal(menu.productStyle,'grid','Produto móvel deve ser horizontal');
            if([390,768,1440].includes(width))await shot('menu-'+width);
            await cdp.eval("document.querySelector('#panquecas-salgadas .product-details').click()");
            await waitFor(()=>cdp.eval("document.getElementById('productDialog').open && !!document.querySelector('#productDialogContent form.order-form')"),5000);
            const modal=await cdp.eval(expression(productModalMetrics));
            within(modal,width);
            assert.ok(modal.top>=-2&&modal.bottom<=height+2,'Janela de produto sai da altura: '+width);
            assert.ok(modal.imageHeight<=212,'Foto alta demais na janela: '+width);
            if(width===390)await shot('produto-390');
            await cdp.eval("document.getElementById('productDialog').close();document.querySelector('.category-toolbar > a').click()");
            await waitFor(()=>cdp.eval("!document.getElementById('categoryHome').hidden"),5000);
            await cdp.eval("document.getElementById('openCart').click()");
            const cart=await cdp.eval(expression(cartModalMetrics));
            within(cart,width);
            assert.ok(cart.top>=-2&&cart.bottom<=height+2,'Carrinho sai da altura: '+width);
            if(width===390)await shot('carrinho-390');
            await cdp.eval("document.getElementById('cartDialog').close()");
            console.log('PASS '+width+'x'+height+' | '+categories+' categorias / '+products+' produtos por linha');
        }
        console.log('PASS responsividade em Chromium real, sem pedido enviado.');
    }finally{
        try{socket?.close()}catch{}
        if(browser)browser.kill('SIGKILL');
        await new Promise(resolve=>server.close(resolve));
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
