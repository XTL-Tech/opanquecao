'use strict';
(()=> {
 const $=s=>document.querySelector(s), el=(tag,text,cls)=>{
  const n=document.createElement(tag);
  if(text!==null&&text!==undefined)n.textContent=String(text);
  if(cls)n.className=cls;
  return n;
 };
 const demo=new URLSearchParams(location.search).get('demo')==='1';
 const S={actor:null,data:null,tab:'orders',selected:null,areas:null,demo};
 const label={pending_customer:'Aguardando cliente',awaiting_acceptance:'Aguardando aceite',
  accepted:'Aceito',completed:'Concluído',delivered:'Entregue',cancelled:'Cancelado'};
 const payment={cash:'Dinheiro',pix:'Pix',credit:'Crédito',debit:'Débito',other:'Outro'};
 const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(n)||0)/100);
 const time=value=>value?new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}):'—';
 const localDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const number=v=>{const m=/^\s*(\d{1,7})(?:[.,](\d{1,2}))?\s*$/.exec(String(v));if(!m)return null;return Number(m[1])*100+Number((m[2]||'').padEnd(2,'0'));};
 const total=o=>o.fulfillment?.type==='delivery'&&o.delivery_fee_cents===null?null:o.subtotal_cents+(o.delivery_fee_cents||0);
 function show(message,error=false){
  const n=$('#notice');n.textContent=message;n.style.background=error?'#fdebec':'#e9f8ed';n.style.color=error?'#8f2d35':'#235639';n.hidden=false;
  clearTimeout(show.handle);show.handle=setTimeout(()=>n.hidden=true,6500);
 }
 function openDialog(id){const n=document.getElementById(id);if(n?.showModal)n.showModal();else n.open=true;}
 function closeDialog(id){const n=document.getElementById(id);if(n?.close)n.close();else n.open=false;}
 function td(row,content,cls){const d=el('td',content,cls);row.append(d);return d;}
 function button(text,fn,cls='soft'){const b=el('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;}
 function clear(n){n.replaceChildren();}
 function stat(target,small,big){const tile=el('div',null,target==='#orderStats'?'stat':'cash-tile');tile.append(el('small',small),el('strong',big));if(target==='#orderStats')tile.append(el('i'));$(target).append(tile);}
 function fakeId(n){return '00000000-0000-4000-8000-'+String(n).padStart(12,'0');}
 function fakeOrder(n,status,product,sub,method='pickup',paid='pending'){
  const id=fakeId(n),stamp=new Date(Date.now()-n*1800000).toISOString();
  return {restaurant_id:'opanquecao',request_id:id,ref_code:String(n).padStart(8,'0'),
   customer_id:fakeId(100+n),origin:n===3?'manual':'site',status,
   telegram_state:'sent',items:[{quantity:1,category:'panquecas-salgadas',
    product,option:'M',cents:sub,flavors:[],freeExtras:[],paidExtras:[],note:''}],
   fulfillment:{type:method,...(method==='delivery'?{city:'Nova Hartz',neighborhood:'Centro',street:'Rua Exemplo',number:'10'}:{})},
   note:'Pedido fictício de demonstração',subtotal_cents:sub,delivery_fee_cents:method==='delivery'?700:null,
   payment_method:paid==='paid'?'pix':null,payment_status:paid,settled_business_date:paid==='paid'&&status==='delivered'?localDate():null,
   created_at:stamp,updated_at:stamp};
 }
 function sample(catalog){
  const names=['Cliente Exemplo 1','Cliente Exemplo 2','Cliente Exemplo 3','Cliente Exemplo 4'];
  const customers=names.map((name,i)=>({id:fakeId(101+i),name,phone:'5100000000'+i,notes:'Cadastro fictício',created_at:new Date().toISOString()}));
  const orders=[fakeOrder(1,'pending_customer','Panquetudo (Especial)',3200,'delivery'),
   fakeOrder(2,'awaiting_acceptance','Frango e Catupiry',2800,'pickup'),
   fakeOrder(3,'accepted','Bacon',2800,'table'),
   fakeOrder(4,'delivered','Mussarela',2300,'pickup','paid')];
  return {today:localDate(),orders,customers,closings:[],catalog:{catalog,revision:1},
   cash:{orders:1,total_cents:2300,cash_cents:0,pix_cents:2300,credit_cents:0,debit_cents:0,other_cents:0}};
 }
 async function request(url,body){
  const opts=body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{method:'GET'};
  const response=await fetch(url,{...opts,cache:'no-store',credentials:'same-origin'});
  let data;try{data=await response.json();}catch{throw Error('O servidor não respondeu com dados válidos.');}
  if(!response.ok)throw Error(data.error||'Não foi possível concluir a operação.');
  return data;
 }
 function client(id){
  const known=S.data?.customers.find(x=>x.id===id);
  if(known)return known;
  // Pedidos trazem nome/telefone em JOIN paginado, sem ter de ler
  // todos os milhares de clientes da base.
  const order=S.data?.orders.find(x=>x.customer_id===id);
  return order?{id,name:order.customer_name,phone:order.customer_phone}:null;
 }
 async function demoAction(action,body){
  const d=S.data;
  if(action==='order_status'){const o=d.orders.find(x=>x.request_id===body.id);o.status=body.next;
   if(body.next==='delivered'&&o.payment_status==='paid')o.settled_business_date=localDate();return {order:o};}
  if(action==='order_fee'){const o=d.orders.find(x=>x.request_id===body.id);o.delivery_fee_cents=body.feeCents;return {order:o};}
  if(action==='order_paid'){const o=d.orders.find(x=>x.request_id===body.id);o.payment_status='paid';o.payment_method=body.method;
   if(o.status==='delivered')o.settled_business_date=localDate();return {order:o};}
  if(action==='customer_save'){
   const o=body.id?d.customers.find(x=>x.id===body.id):{id:fakeId(200+d.customers.length)};
   Object.assign(o,{name:body.name,phone:body.phone,notes:body.notes});
   if(!body.id)d.customers.unshift(o);return {customer:o};
  }
  if(action==='catalog_price'){
   const cat=d.catalog.catalog.categorias.find(x=>x.id===body.category);
   const item=cat.itens.find(x=>x.nome===body.product);
   const price=money(body.priceCents);
   if(body.variant==='preco')item.preco=price;
   else if(body.variant.startsWith('size:'))item.tamanhos[body.variant.slice(5)]=price;
   else {const v=item.tamanhos_acai.find(x=>x.tamanho===body.variant.slice(5));v.preco=price;}
   d.catalog.revision++;return {catalog:d.catalog};
  }
  if(action==='cash_close'){
   const summary=tally();
   const closing={business_date:body.date,summary,counted_cash_cents:body.countedCashCents,
    discrepancy_cents:body.countedCashCents-summary.cash_cents,notes:body.notes,closed_at:new Date().toISOString()};
   d.closings.unshift(closing);return {closing};
  }
  if(action==='manual_order'){
   const customer=d.customers.find(x=>x.phone===body.phone)||
    {id:fakeId(400+d.customers.length),phone:body.phone,name:body.name,notes:''};
   if(!d.customers.some(x=>x.id===customer.id))d.customers.unshift(customer);
   const item=body.lines[0],id=fakeId(20+d.orders.length);
   const order={...fakeOrder(20+d.orders.length,'awaiting_acceptance',item.product,item.cents*item.quantity,body.fulfillment.type),
    request_id:id,ref_code:String(20+d.orders.length).padStart(8,'0'),customer_id:customer.id,
    fulfillment:body.fulfillment,items:body.lines,note:body.note,origin:'manual',payment_status:'pending'};
   d.orders.unshift(order);return {order};
  }
  throw Error('Ação não disponível na demonstração.');
 }
 async function run(action,body){
  if(S.demo)return demoAction(action,body);
  return request('/api/backoffice',{action,...body});
 }
 function tally(){
  const date=S.data.today,result={orders:0,total_cents:0,cash_cents:0,pix_cents:0,credit_cents:0,debit_cents:0,other_cents:0};
  for(const o of S.data.orders)if(o.status==='delivered'&&o.payment_status==='paid'&&o.settled_business_date===date){
   const v=total(o);if(v===null||!payment[o.payment_method])continue;
   result.orders++;result.total_cents+=v;result[o.payment_method+'_cents']+=v;
  }
  return result;
 }
 async function reload(){
  try{
   if(!S.demo){
    const next=await request('/api/backoffice?action=dashboard');
    if(S.data?.catalog)next.catalog=S.data.catalog;
    S.data=next;S.moreOrders=next.orders.length>=80;
   }else S.data.cash=tally();
   render();
  }catch(e){show(e.message,true);if(!S.demo&&/login|sessão|Conta sem/i.test(e.message))loggedOut();}
 }
 async function ensureCatalog(force=false){
  if(S.demo||(!force&&S.data?.catalog?.catalog))return;
  try{
   const result=await request('/api/backoffice?action=catalog');
   S.data.catalog=result.catalog;
   if(S.tab==='catalog')renderCatalog();
  }catch(e){show(e.message,true);}
 }
 function showTab(tab){
  S.tab=tab;for(const name of ['orders','customers','cash','catalog'])$('#tab-'+name).hidden=name!==tab;
  document.querySelectorAll('[data-tab]').forEach(n=>n.classList.toggle('active',n.dataset.tab===tab));
  const meta={orders:['Pedidos','Acompanhe cada pedido, do primeiro contato à entrega.'],
   customers:['Clientes','Cadastros e relacionamento com o cliente.'],
   cash:['Caixa diário','Conferência e fechamento dos pagamentos recebidos.'],
   catalog:['Preços do cardápio','Ajuste de valores, com histórico e autorização.']};
  $('#pageTitle').textContent=meta[tab][0];$('#pageSubtitle').textContent=meta[tab][1];
  if(S.data){
   renderTab();if(tab==='catalog')ensureCatalog(true);
   if(tab==='cash')refreshAsaas();
  }
 }
 function render(){if(!S.data)return;$('#todayText').textContent='📅 '+S.data.today.split('-').reverse().join('/');
  $('#staffLabel').textContent=S.actor.email||'Atendente';
  $('#staffRole').textContent=S.actor.role==='manager'?'Gestão':'Atendimento';
  $('#pendingCount').textContent=S.data.orders.filter(x=>['pending_customer','awaiting_acceptance'].includes(x.status)).length||'';
  renderTab();
 }
 function renderTab(){if(S.tab==='orders')renderOrders();if(S.tab==='customers')renderCustomers();if(S.tab==='cash')renderCash();if(S.tab==='catalog')renderCatalog();}
 async function lookupOrders(more=false){
  if(S.demo||!S.data)return renderOrders();
  try{
   const term=$('#orderSearch').value.trim(),status=$('#orderStatusFilter').value;
   const last=more?S.data.orders.at(-1):null;
   const q=new URLSearchParams({action:'orders',term,status});
   if(last?.created_at&&last.request_id){
    q.set('before',last.created_at);q.set('beforeId',last.request_id);
   }
   const result=await request('/api/backoffice?'+q.toString());
   const rows=result.orders||[];
   S.moreOrders=rows.length>50;
   const page=rows.slice(0,50);
   if(more){
    const existing=new Set(S.data.orders.map(x=>x.request_id));
    S.data.orders.push(...page.filter(x=>!existing.has(x.request_id)));
   }else S.data.orders=page;
   renderOrders();
  }catch(e){show(e.message,true);}
 }
 function renderOrders(){
  const orders=S.data.orders,term=$('#orderSearch').value.trim().toLowerCase(),filter=$('#orderStatusFilter').value;
  const counts=S.data.queueCounts||{};
  clear($('#orderStats'));stat('#orderStats','Aguardando cliente',counts.pending_customer??orders.filter(o=>o.status==='pending_customer').length);
  stat('#orderStats','Aguardando aceite',counts.awaiting_acceptance??orders.filter(o=>o.status==='awaiting_acceptance').length);
  stat('#orderStats','Em atendimento',S.data.queueCounts?
   (counts.accepted||0)+(counts.completed||0):orders.filter(o=>['accepted','completed'].includes(o.status)).length);
  stat('#orderStats','Entregues e pagos hoje',S.data.queueCounts?
   S.data.cash.orders:orders.filter(o=>o.status==='delivered').length);
  const target=$('#ordersTable');clear(target);
  const matches=orders.filter(o=>{
   const cl=client(o.customer_id),s=[o.ref_code,cl?.name,cl?.phone].join(' ').toLowerCase();
   return (!filter||o.status===filter)&&(!term||s.includes(term));
  });
  $('#ordersEmpty').hidden=matches.length>0;
  $('#moreOrders').hidden=S.demo||(!S.moreOrders&&orders.length<80);
  for(const o of matches){
   const tr=el('tr');td(tr,'#'+o.ref_code,'td-primary');const who=td(tr,client(o.customer_id)?.name||'Cliente indisponível');
   who.append(el('small',client(o.customer_id)?.phone||'', 'td-secondary'));
   const type={delivery:'Entrega',pickup:'Retirada',table:'Mesa'}[o.fulfillment?.type]||'—';
   td(tr,type);td(tr,money(o.subtotal_cents));
   td(tr,label[o.status], '');tr.children[4].className='';tr.children[4].replaceChildren(el('span',label[o.status],'status-tag s-'+o.status));
   td(tr,time(o.created_at));td(tr,null).append(button('Abrir',()=>openOrder(o.request_id),'td-btn'));
   target.append(tr);
  }
 }
 function renderCustomers(){
  const target=$('#customersTable');clear(target);const term=$('#clientSearch').value.trim().toLowerCase();
  for(const c of S.data.customers.filter(c=>[c.name,c.phone].join(' ').toLowerCase().includes(term))){
   const tr=el('tr');td(tr,c.name,'td-primary');td(tr,c.phone);td(tr,c.notes?.slice(0,80)||'—');
   td(tr,null).append(button('Editar',()=>openCustomer(c),'td-btn'));target.append(tr);
  }
 }
 async function refreshAsaas(){
  const card=$('#asaasSandboxCard'),btn=$('#asaasSandboxCreate');
  if(S.demo||S.actor?.role!=='manager'){
   card.hidden=true;return;
  }
  card.hidden=false;btn.disabled=true;
  try{
   const info=await request('/api/asaas-sandbox');
   btn.disabled=!info.enabled;
   const latest=info.recent?.[0];
   $('#asaasSandboxStatus').textContent=info.enabled?
    'Sandbox configurado · Último teste: '+(latest?latest.status+' ('+time(latest.created_at)+')':'nenhum'):
    'Configure chave e webhook Sandbox na Vercel para liberar os testes.';
  }catch(e){btn.disabled=true;$('#asaasSandboxStatus').textContent='Sandbox indisponível: '+e.message;}
 }
 function renderCash(){
  const data=S.data,date=data.today,closing=data.closings.find(x=>x.business_date===date);
  const cash=S.demo?tally():data.cash;clear($('#cashCards'));
  for(const [lbl,value] of [['Total recebido',cash.total_cents],['Dinheiro',cash.cash_cents],['Pix',cash.pix_cents],
   ['Cartão crédito',cash.credit_cents],['Cartão débito',cash.debit_cents],['Outros',cash.other_cents]]){
   stat('#cashCards',lbl,money(value));
  }
  $('#cashStatus').textContent=closing?'Caixa fechado':'Caixa aberto';
  $('#cashForm').hidden=!!closing;
  const tbody=$('#closingsTable');clear(tbody);
  for(const e of data.closings){
   const tr=el('tr');td(tr,e.business_date.split('-').reverse().join('/'));
   td(tr,e.summary?.orders||0);td(tr,money(e.summary?.total_cents));
   td(tr,money(e.counted_cash_cents));td(tr,money(e.discrepancy_cents));tbody.append(tr);
  }
  updateDifference();
 }
 function updateDifference(){
  if(!S.data)return;const amount=number($('#countedCash').value),cash=(S.demo?tally():S.data.cash).cash_cents;
  $('#cashDifference').textContent=amount===null?'Informe quanto há em dinheiro físico.':
   'Esperado: '+money(cash)+' · Contado: '+money(amount)+' · Diferença: '+money(amount-cash);
 }
 function variants(item) {
  const out=[];
  if(typeof item.preco==='string')out.push({variant:'preco',label:'Preço único',price:item.preco});
  if(item.tamanhos)for(const [key,price] of Object.entries(item.tamanhos))out.push({variant:'size:'+key,label:key,price});
  if(Array.isArray(item.tamanhos_acai))for(const x of item.tamanhos_acai)
   if(typeof x.preco==='string')out.push({variant:'acai:'+x.tamanho,label:x.tamanho,price:x.preco});
  return out;
 }
 function renderCatalog(){
  const catalog=S.data.catalog?.catalog, target=$('#catalogTable');clear(target);
  const canEdit=S.actor.role==='manager'&&(S.demo||S.data.catalogWritable!==false);
  $('#catalogNotice').textContent=canEdit?'Alterações registradas com revisão do catálogo. Pedido antigo não muda de preço.':
   'Somente uma conta de gestão pode alterar valores.';
  const term=$('#catalogSearch').value.trim().toLowerCase();
  for(const cat of catalog?.categorias||[])for(const item of cat.itens||[]){
   if(![cat.titulo,item.nome].join(' ').toLowerCase().includes(term))continue;
   for(const v of variants(item)){
    const tr=el('tr');const desc=td(tr,item.nome,'td-primary');
    desc.append(el('small',cat.titulo,'td-secondary'));td(tr,v.label);td(tr,v.price);
    const cell=td(tr,null);
    if(canEdit)cell.append(button('Alterar',()=>openPrice(cat,item,v),'td-btn'));
    else cell.textContent='—';target.append(tr);
   }
  }
 }
 function block(label,value){const n=el('div');n.append(el('small',label),el('strong',value||'—'));return n;}
 function openOrder(id){
  const o=S.data.orders.find(x=>x.request_id===id);if(!o)return;
  S.selected=id;
  const customer=client(o.customer_id),body=$('#detailBody'),actions=$('#detailActions');clear(body);clear(actions);
  $('#detailTitle').textContent='#'+o.ref_code;$('#detailEyebrow').textContent=label[o.status]+' · '+time(o.created_at);
  const meta=el('div',null,'detail-meta');
  meta.append(block('Cliente',customer?.name),block('WhatsApp',customer?.phone),
   block('Modalidade',{delivery:'Entrega',pickup:'Retirada',table:'Mesa'}[o.fulfillment?.type]),
   block('Pagamento',o.payment_status==='paid'?'Recebido · '+(payment[o.payment_method]||'—'):'Pendente'));
  body.append(meta);
  const items=el('ul',null,'lines');
  for(const item of o.items||[]){
   const li=el('li');const left=el('div');
   left.append(el('strong',item.quantity+'x '+item.product));
   const details=[item.option!=='Único'?item.option:null,item.flavors?.join(' / '),item.freeExtras?.length?'Grátis: '+item.freeExtras.join(', '):null,
    item.paidExtras?.length?'Adicionais: '+item.paidExtras.join(', '):null,item.note].filter(Boolean).join(' · ');
   if(details)left.append(el('span',details,'sub'));
   li.append(left,el('b',money(item.cents*item.quantity)));items.append(li);
  }
  body.append(items);
  if(o.fulfillment?.type==='delivery'){
   const f=o.fulfillment;
   body.append(el('div',[f.street,f.number,f.neighborhood,f.city].filter(Boolean).join(', ')+(f.complement?' · '+f.complement:'')+(f.reference?' · Ref.: '+f.reference:''),'text-block'));
   if(o.delivery_fee_cents===null&&['pending_customer','awaiting_acceptance'].includes(o.status)){
    const container=el('div',null,'payment-box');container.append(el('h3','Definir taxa de entrega'));
    const input=el('input');input.placeholder='7,00';input.inputMode='decimal';
    container.append(input,button('Salvar taxa',async()=>{
     const fee=number(input.value);if(fee===null)return show('Taxa inválida.',true);
     await mutate('order_fee',{id,feeCents:fee},'Taxa atualizada.');
    },'primary'));body.append(container);
   }
  }else if(o.fulfillment?.type==='table')body.append(el('p','Mesa/comanda: '+o.fulfillment.table));
  if(o.note)body.append(el('div','Observação: '+o.note,'text-block'));
  const due=total(o),summary=el('div',null,'total-line');
  summary.append(el('span','Total previsto'),el('strong',due===null?'Entrega a confirmar':money(due)));body.append(summary);
  if(o.origin==='site'&&o.telegram_state!=='sent')body.append(el('p','⚠️ Telegram não confirmado; verifique o contato e o cupom antes do aceite.','hint'));
  if(customer&&!S.demo)actions.append(button('WhatsApp',()=>window.open('https://wa.me/55'+customer.phone,'_blank','noopener,noreferrer')));
  const choices={pending_customer:[['Cliente confirmou','awaiting_acceptance'],['Cancelar','cancelled']],
   awaiting_acceptance:[['Aceitar pedido','accepted'],['Cancelar','cancelled']],
   accepted:[['Marcar concluído','completed'],['Cancelar','cancelled']],
   completed:[['Marcar entregue','delivered'],['Cancelar','cancelled']]};
  for(const [text,next] of choices[o.status]||[])actions.append(button(text,async()=>{
   if(next==='accepted'&&due===null)return show('Defina a taxa de entrega antes de aceitar.',true);
   if(next==='cancelled'&&o.payment_status==='paid')return show('Pedido pago exige estorno; não pode cancelar aqui.',true);
   if(['cancelled','delivered'].includes(next)&&!confirm('Confirmar: '+text.toLowerCase()+'?'))return;
   await mutate('order_status',{id,next},'Situação atualizada.');
  },next==='cancelled'?'soft danger':'primary'));
  if(['accepted','completed','delivered'].includes(o.status)&&o.payment_status==='pending'){
   const box=el('div',null,'payment-box');box.append(el('h3','Registrar pagamento recebido'));
   const sel=el('select');for(const [key,value] of Object.entries(payment)){const opt=el('option',value);opt.value=key;sel.append(opt);}
   const label=el('label');const check=el('input');check.type='checkbox';label.append(check,el('span','Confirmo que o pagamento já foi recebido'));
   box.append(sel,label,button('Marcar como pago',async()=>{
    if(!check.checked)return show('Confirme o recebimento do pagamento.',true);
    if(!confirm('Confirmar o recebimento de '+money(due)+'?'))return;
    await mutate('order_paid',{id,method:sel.value,received:true},'Pagamento registrado.');
   },'primary'));
   body.append(box);
  }
  actions.append(button('Histórico',async()=>{
   try{
    const records=S.demo?[]:(await request('/api/backoffice?action=events&id='+encodeURIComponent(id))).events;
    const lines=records.map(x=>time(x.changed_at)+' · '+(label[x.old_values?.status]||'')+' → '+(label[x.new_values?.status]||''));
    show(lines.join(' | ')||'Nenhuma alteração registrada.');
   }catch(e){show(e.message,true);}
  }));
  openDialog('detailDialog');
 }
 async function mutate(action,body,success){
  try{
   const result=await run(action,body);
   if(action==='catalog_price'&&result?.catalog)S.data.catalog=result.catalog;
   await reload();closeDialog('detailDialog');closeDialog('customerDialog');closeDialog('priceDialog');closeDialog('manualDialog');show(S.demo?'DEMONSTRAÇÃO: '+success:success);}
  catch(e){show(e.message,true);}
 }
 function openCustomer(c){
  $('#customerForm').reset();$('#customerId').value=c?.id||'';
  $('#customerName').value=c?.name||'';$('#customerPhone').value=c?.phone||'';
  $('#customerNotes').value=c?.notes||'';$('#customerFormTitle').textContent=c?'Editar cliente':'Novo cliente';
  openDialog('customerDialog');
 }
 function openPrice(cat,item,v){
  $('#priceDescription').textContent=item.nome+' · '+v.label+' · Atual: '+v.price;
  $('#priceCategory').value=cat.id;$('#priceProduct').value=item.nome;$('#priceVariant').value=v.variant;
  $('#newPrice').value=/\d/.test(v.price)?v.price.replace(/[^\d,]/g,'').trim():'';
  openDialog('priceDialog');
 }
 async function fillManual(){
  if(!S.data?.catalog?.catalog)return;
  const cats=S.data.catalog.catalog.categorias.filter(x=>x.id!=='panquecas-2-sabores');clear($('#manualCategory'));
  for(const cat of cats){const o=el('option',cat.titulo);o.value=cat.id;$('#manualCategory').append(o);}
  await fillProduct();await fillNeighborhood();
 }
 async function fillProduct(){
  clear($('#manualProduct'));const cat=S.data.catalog.catalog.categorias.find(x=>x.id===$('#manualCategory').value);
  for(const item of cat?.itens||[]){
   const prices=variants(item).filter(x=>/^R\$\s*\d+,\d{2}$/.test(x.price));
   if(!prices.length)continue;
   const opt=el('option',item.nome);opt.value=item.nome;$('#manualProduct').append(opt);
  }
  fillVariant();
 }
 function fillVariant(){
  clear($('#manualVariant'));const cat=S.data.catalog.catalog.categorias.find(x=>x.id===$('#manualCategory').value);
  const item=cat?.itens?.find(x=>x.nome===$('#manualProduct').value);
  for(const v of variants(item||{}).filter(x=>/^R\$\s*\d+,\d{2}$/.test(x.price))){
   const opt=el('option',v.label+' · '+v.price);opt.value=v.variant;opt.dataset.price=v.price;
   $('#manualVariant').append(opt);
  }
 }
 async function fillNeighborhood(){
  if(!S.areas){try{S.areas=await request('/delivery-areas.json');}catch{S.areas={cities:{}};}}
  clear($('#manualNeighborhood'));
  for(const a of S.areas.cities?.[$('#manualCity').value]||[]){
   const option=el('option',a.name);option.value=a.name;$('#manualNeighborhood').append(option);
  }
 }
 function updateManualType(){
  const type=$('#manualForm').elements.type.value;
  $('#manualDelivery').hidden=type!=='delivery';$('#manualTable').hidden=type!=='table';
 }
 function parseMobilePrice(text){
  const match=/R\$\s*(\d+),(\d{2})/.exec(text||'');return match?Number(match[1])*100+Number(match[2]):null;
 }
 function loggedOut(){S.actor=null;S.data=null;$('#appShell').hidden=true;$('#loginScreen').hidden=false;}
 async function boot(){
  for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>closeDialog(b.dataset.close));
  $('#navigation').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)showTab(b.dataset.tab);});
  $('#refresh').addEventListener('click',reload);
  $('#orderSearch').addEventListener('input',()=>{
    if(S.demo)return renderOrders();
    clearTimeout(S.orderSearchTimer);
    S.orderSearchTimer=setTimeout(()=>lookupOrders(),450);
  });
  $('#orderStatusFilter').addEventListener('change',()=>lookupOrders());
  $('#moreOrders').addEventListener('click',()=>lookupOrders(true));
  $('#clientSearch').addEventListener('input',()=>{
    clearTimeout(S.searchTimer);
    if(S.demo)return renderCustomers();
    S.searchTimer=setTimeout(async()=>{
      if(S.tab!=='customers')return;
      try{
        const term=$('#clientSearch').value.trim();
        const result=await request('/api/backoffice?action=customers&term='+encodeURIComponent(term));
        S.data.customers=result.customers;
        renderCustomers();
      }catch(e){show(e.message,true);}
    },450);
  });
  $('#catalogSearch').addEventListener('input',renderCatalog);
  $('#newCustomer').addEventListener('click',()=>openCustomer(null));
  $('#newOrder').addEventListener('click',async()=>{
    await ensureCatalog();
    if(!S.data?.catalog?.catalog)return show('Catálogo indisponível.',true);
    $('#manualForm').reset();await fillManual();updateManualType();openDialog('manualDialog');
  });
  $('#manualForm').elements.type.addEventListener('change',updateManualType);
  $('#manualCity').addEventListener('change',fillNeighborhood);
  $('#manualCategory').addEventListener('change',fillProduct);
  $('#manualProduct').addEventListener('change',fillVariant);
  $('#countedCash').addEventListener('input',updateDifference);
  $('#asaasSandboxCreate').addEventListener('click',async()=>{
   const b=$('#asaasSandboxCreate');b.disabled=true;
   try{
    if(!confirm('Criar um checkout FICTÍCIO de R$ 5,00 no Asaas Sandbox?'))return;
    const result=await request('/api/asaas-sandbox',{action:'create_sandbox_checkout'});
    const a=el('a','Abrir página de teste do Asaas');a.href=result.link;
    a.target='_blank';a.rel='noopener noreferrer';
    $('#asaasSandboxLink').replaceChildren(a);
    show('Checkout fictício criado. Confira o Asaas Sandbox, sem pagamento real.');
   }catch(e){show(e.message,true);}
   finally{await refreshAsaas();}
  });
  $('#customerForm').addEventListener('submit',async e=>{
   e.preventDefault();
   await mutate('customer_save',{id:$('#customerId').value||null,name:$('#customerName').value,
    phone:$('#customerPhone').value,notes:$('#customerNotes').value},'Cliente salvo.');
  });
  $('#priceForm').addEventListener('submit',async e=>{
   e.preventDefault();const cents=number($('#newPrice').value);
   if(cents===null||cents===0)return show('Informe um preço válido.',true);
   if(!confirm('Alterar o preço para '+money(cents)+'?'))return;
   await mutate('catalog_price',{category:$('#priceCategory').value,product:$('#priceProduct').value,
    variant:$('#priceVariant').value,priceCents:cents,revision:S.data.catalog.revision},'Preço atualizado.');
  });
  $('#cashForm').addEventListener('submit',async e=>{
   e.preventDefault();const counted=number($('#countedCash').value);
   if(counted===null)return show('Informe o dinheiro contado.',true);
   if(!confirm('Confirmar o fechamento de '+S.data.today+'? Esta ação é definitiva.'))return;
   await mutate('cash_close',{date:S.data.today,countedCashCents:counted,notes:$('#cashNotes').value},'Caixa fechado.');
  });
  $('#manualForm').addEventListener('submit',async e=>{
   e.preventDefault();const f=e.currentTarget,catId=$('#manualCategory').value;
   const item=S.data.catalog.catalog.categorias.find(x=>x.id===catId)?.itens.find(x=>x.nome===$('#manualProduct').value);
   const variant=$('#manualVariant').selectedOptions[0],quantity=Number($('#manualQuantity').value);
   if(!item||!variant||!Number.isInteger(quantity)||quantity<1||quantity>20)return show('Confira os itens.',true);
   const type=f.elements.type.value;
   const fulfillment=type==='delivery'?{type,city:$('#manualCity').value,neighborhood:$('#manualNeighborhood').value,
    street:$('#manualStreet').value,number:$('#manualNumber').value,complement:$('#manualComplement').value,reference:''}:
    type==='table'?{type,table:f.elements.table.value}:{type:'pickup'};
   const line={category:catId,product:item.nome,option:variant.value==='preco'?'Único':variant.value.startsWith('size:')?variant.value.slice(5):variant.value.slice(5),
    quantity,note:'',flavors:[],freeExtras:[],paidExtras:[],cents:parseMobilePrice(variant.dataset.price)};
   await mutate('manual_order',{name:f.elements.name.value,phone:f.elements.phone.value,
    fulfillment,lines:[line],note:$('#manualNote').value},'Pedido manual criado.');
  });
  $('#logout').addEventListener('click',async()=>{
   if(!S.demo)try{await run('logout',{});}catch{}
   location.href='/backoffice/';
  });
  $('#loginForm').addEventListener('submit',async e=>{
   e.preventDefault();$('#loginError').textContent='';
   try{const response=await run('login',{email:$('#email').value,password:$('#password').value});
    S.actor=response.actor;$('#loginScreen').hidden=true;$('#appShell').hidden=false;await reload();
   }catch(err){$('#loginError').textContent=err.message;}
  });
  if(S.demo){
   const catalog=await request('/cardapio.json');S.data=sample(catalog);
   S.actor={role:'manager',email:'demonstracao@exemplo.invalid'};$('#loginScreen').hidden=true;$('#appShell').hidden=false;
   $('#demoRibbon').hidden=false;render();return;
  }
  try{const status=await request('/api/backoffice?action=status');
   if(!status.enabled){$('#setupNotice').hidden=false;$('#loginForm').querySelector('button[type=submit]').disabled=true;}
   else{const session=await request('/api/backoffice?action=session');
    S.actor=session.actor;$('#loginScreen').hidden=true;$('#appShell').hidden=false;await reload();}
  }catch{/* Sessão ausente: a tela de login permanece visível. */}
 }
 boot().catch(err=>{$('#loginError').textContent='Não foi possível iniciar o painel: '+err.message;});
})();
