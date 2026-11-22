'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),
    {url:'https://opanquecao.vercel.app/',runScripts:'outside-only'});
const w=dom.window,d=w.document;
Object.assign(global,{window:w,document:d,Option:w.Option});
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
w.HTMLDialogElement.prototype.close=function(){this.open=false};
w.HTMLElement.prototype.scrollIntoView=function(){};
(async()=>{
    const inline=[...d.querySelectorAll('script:not([src])')].at(-1).textContent;
    w.eval(inline.replace(/\n\s*initMenu\(\);\s*$/,''));
    const {orderOptions,money,flavorChoices,priceOrder}=await import(path.resolve('order-catalog.mjs'));
    await import(path.resolve('cart.mjs'));
    w.renderMenu(catalog);
    d.dispatchEvent(new w.CustomEvent('menu-ready',{detail:catalog}));
    const dialog=d.getElementById('productDialog');
    const localCart=()=>JSON.parse(w.localStorage.getItem('disk-panquecao-cart-v1')).lines;
    const close=()=>{if(dialog.open)dialog.close()};
    let entries=0,cardsCount=0,forms=0,consults=0,adds=0,images=0,variants=0;
    for(const category of catalog.categorias){
        const section=d.getElementById(category.id);
        assert.ok(section,'Categoria ausente: '+category.id);
        d.querySelector('.category-card[href="#'+category.id+'"]').click();
        assert.equal(section.hidden,false,'Categoria não abriu: '+category.id);
        const cards=[...section.querySelectorAll('.menu-item')];
        const expectedCount=category.itens.reduce((sum,item)=>sum+
            (item.tamanhos_acai?item.tamanhos_acai.filter(x=>/^\d+ml$/i.test(x.tamanho)).length:1),0);
        assert.equal(cards.length,expectedCount,'Quantidade de cards: '+category.id);
        for(const item of category.itens){
            entries++;
            const matching=cards.filter(card=>card.dataset.product===item.nome);
            const sizes=item.tamanhos_acai
                ?item.tamanhos_acai.filter(x=>/^\d+ml$/i.test(x.tamanho)).map(x=>x.tamanho)
                :[null];
            assert.equal(matching.length,sizes.length,'Card ausente ou repetido: '+category.id+'/'+item.nome);
            for(let index=0;index<matching.length;index++){
                cardsCount++;
                const card=matching[index],size=sizes[index];
                const key=category.id+'/'+item.nome+(size?' ('+size+')':'');
                const options=orderOptions(item).filter(x=>!size||x.label===size);
                const consult=options.length===0;
                assert.equal(card.dataset.option||null,size,'Tamanho incorreto: '+key);
                const title=card.querySelector('.item-title');
                const button=card.querySelector(':scope > .card-primary-action');
                assert.ok(title&&button,'Título/ação ausentes: '+key);
                const quick=button.classList.contains('quick-add');
                if(consult){
                    assert.equal(quick,false,'Consulta com botão Adicionar: '+key);
                    assert.match(button.textContent,/Consultar preço/,'Texto incorreto para consulta: '+key);
                }
                const expectedTitle=category.titulo+' · '+title.textContent;
                // Abrir pelo nome, que delega para a ação de detalhes do card.
                title.click();
                assert.equal(dialog.open,true,'Título não abriu modal: '+key);
                assert.equal(d.getElementById('productDialogTitle').textContent,expectedTitle,
                    'Título abriu outro item: '+key);
                assert.equal(d.querySelectorAll('#productDialogContent form.order-form').length,consult?0:1,
                    'Ficha ausente ou duplicada: '+key);
                const desc=card.querySelector('.item-desc');
                if(desc)assert.equal(d.querySelector('#productDialogContent .item-desc')?.textContent,
                    desc.textContent,'Descrição errada: '+key);
                if(consult){
                    consults++;
                    const contact=d.querySelector('#productDialogContent a.cart-whatsapp');
                    assert.ok(contact,'Link de consulta ausente: '+key);
                    assert.ok(new URL(contact.href).searchParams.get('text').includes(item.nome),
                        'Consulta direciona ao produto errado: '+key);
                }else{
                    forms++;
                    const form=d.querySelector('#productDialogContent form.order-form');
                    assert.equal(form.elements.option.options.length,options.length,'Opções incorretas: '+key);
                    options.forEach((x,i)=>assert.equal(form.elements.option.options[i].value,x.label,
                        'Opção de outro produto: '+key));
                    assert.ok(form.querySelector('.order-primary').textContent.includes(money(options[0].cents)),
                        'Preço inicial incorreto: '+key);
                    if(options.length>1){
                        variants++;
                        const radios=[...form.querySelectorAll('input[name="choice"]')];
                        assert.equal(radios.length,options.length,'Tamanhos incorretos: '+key);
                        radios.at(-1).click();
                        assert.equal(form.elements.option.value,options.at(-1).label,
                            'Tamanho selecionado errado: '+key);
                        assert.ok(form.querySelector('.order-primary').textContent.includes(money(options.at(-1).cents)),
                            'Preço da opção errada: '+key);
                    }
                    if(item.tamanhos_acai){
                        const free=form.querySelector('input[name="freeExtra"]');
                        const paid=form.querySelector('input[name="paidExtra"]');
                        assert.ok(free&&paid,'Complementos de açaí ausentes: '+key);
                        free.click();paid.click();
                    }
                    const flavors=flavorChoices(catalog,category.id,item.nome);
                    if(flavors){
                        const selects=[...form.querySelectorAll('select[name^="flavor"]')];
                        assert.equal(selects.length,2,'Seletores de dois sabores: '+key);
                        selects[0].value=flavors[0].options[0];
                        selects[1].value=flavors[1].options.find(x=>x!==selects[0].value);
                        for(const select of selects)select.dispatchEvent(new w.Event('change',{bubbles:true}));
                    }
                    const before=localCart().length;
                    form.onsubmit({preventDefault(){}});
                    assert.equal(dialog.open,false,'Modal não fechou após adicionar: '+key);
                    assert.equal(localCart().length,before+1,
                        'Não adicionou: '+key+' '+form.querySelector('[role="status"]')?.textContent);
                    const added=localCart().at(-1);
                    assert.equal(added.category,category.id,'Categoria errada no carrinho: '+key);
                    assert.equal(added.product,item.nome,'Produto errado no carrinho: '+key);
                    assert.equal(added.option,options.at(-1).label,'Opção errada no carrinho: '+key);
                    assert.equal(priceOrder(catalog,[added])[0].cents,added.cents,'Preço incorreto: '+key);
                    adds++;
                    const remove=d.querySelector('#cartLines .cart-line:last-child .cart-remove');
                    assert.ok(remove,'Não pode remover: '+key);
                    remove.click();
                    assert.equal(localCart().length,before,'Remoção falhou: '+key);
                }
                close();
                const photo=card.querySelector('.item-photo img');
                if(photo){
                    images++;photo.click();
                    assert.equal(dialog.open,true,'Foto não abriu: '+key);
                    assert.equal(d.getElementById('productDialogTitle').textContent,expectedTitle,
                        'Foto abriu outro item: '+key);
                    close();
                }
                const before=localCart().length;
                button.click();
                if(quick){
                    assert.equal(localCart().length,before+1,'Adição direta falhou: '+key);
                    assert.equal(localCart().at(-1).category,category.id,'Categoria errada ao adicionar: '+key);
                    assert.equal(localCart().at(-1).product,item.nome,'Produto errado ao adicionar: '+key);
                    d.querySelector('#cartLines .cart-line:last-child .cart-remove').click();
                    assert.equal(localCart().length,before,'Remoção direta falhou: '+key);
                }else{
                    assert.equal(dialog.open,true,'Botão não abriu: '+key);
                    assert.equal(d.getElementById('productDialogTitle').textContent,expectedTitle,
                        'Botão abriu outro item: '+key);
                    close();
                }
            }
        }
        d.querySelector('.category-toolbar > a').click();
        assert.equal(d.querySelector('#categoryHome').hidden,false,'Voltar falhou: '+category.id);
    }
    assert.equal(entries,82);
    assert.equal(cardsCount,83);
    assert.equal(consults,2);
    assert.equal(forms+consults,cardsCount);
    assert.equal(adds,81);
    assert.equal(localCart().length,0);
    console.log('PASS AUDITORIA: '+entries+' produtos, '+cardsCount+' cards, '+forms+
        ' fichas, '+consults+' consultas, '+adds+' testes de inclusão/remoção, '+
        images+' fotos e '+variants+' mudanças de tamanho. Todos abriram seus próprios itens.');
})().catch(error=>{console.error(error);process.exitCode=1});
