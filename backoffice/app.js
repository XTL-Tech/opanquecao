'use strict';
(()=> {
 const $=s=>document.querySelector(s), el=(tag,text,cls)=>{
  const n=document.createElement(tag);
  if(text!==null&&text!==undefined)n.textContent=String(text);
  if(cls)n.className=cls;
  return n;
 };
 const demo=new URLSearchParams(location.search).get('demo')==='1';
 const S={actor:null,data:null,tab:'orders',selected:null,areas:null,demo,catalogLoadedAt:0,catalogPending:null};
 const label={pending_customer:'Aguardando cliente',awaiting_acceptance:'Aguardando aceite',
  accepted:'Aceito',preparing:'Em preparo',returned_to_attendant:'Devolvido ao atendimento',completed:'Preparado',out_for_delivery:'Saiu para entrega',delivered:'Entregue',cancelled:'Cancelado'};
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
 // Somente arquivos públicos: não envia cookies e respeita o cache HTTP estático.
 async function staticData(url){
  const response=await fetch(url,{credentials:'omit',cache:'default'});
  if(!response.ok)throw Error('Dados públicos indisponíveis.');
  return response.json();
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
 let reloadBusy=false;
 async function reload(){
  if(reloadBusy)return;
  reloadBusy=true;
  const actor=S.actor;
  try{
   if(!S.demo){
    const next=await request('/api/backoffice?action=dashboard');
    if(S.actor!==actor)return;
    if(S.data?.catalog)next.catalog=S.data.catalog;
    S.data=next;S.moreOrders=next.orders.length>=80;
   }else S.data.cash=tally();
   render();
  }catch(e){show(e.message,true);if(!S.demo&&/login|sessão|Conta sem/i.test(e.message))loggedOut();}
  finally{reloadBusy=false;}
 }
 async function ensureCatalog(force=false){
  if(!S.data||!S.actor)return;
  if(S.data.catalog?.catalog&&(S.demo||(!force&&Date.now()-S.catalogLoadedAt<30000)))return;
  if(S.catalogPending)return S.catalogPending;
  const actor=S.actor;
  const pending=(async()=>{
   try{
    const result=S.demo?{catalog:{catalog:await staticData('/cardapio.json'),revision:1}}:
      await request('/api/backoffice?action=catalog');
    if(S.actor!==actor||!S.data)return;
    S.data.catalog=result.catalog;S.catalogLoadedAt=Date.now();
    if(S.tab==='catalog')renderCatalog();
   }catch(e){
    if(S.actor===actor){if(S.tab==='catalog'&&!S.data?.catalog?.catalog)$('#catalogNotice').textContent='Catálogo indisponível. Toque em Atualizar para tentar novamente.';show(e.message,true);}
   }
  })();
  S.catalogPending=pending;
  try{await pending;}finally{if(S.catalogPending===pending)S.catalogPending=null;}
 }
 function showTab(tab){
  if(S.data?.operational)return;
  if(['kitchen','courier','integrations'].includes(tab)&&S.actor?.role!=='admin')return;
  if(['reports','bi','ranking','fiscal'].includes(tab)&&!['admin','manager'].includes(S.actor?.role))return;
  if(tab!=='bi')exitBiTV();
  $('#tab-operational').hidden=true;
  S.tab=tab;for(const name of ['orders','customers','cash','catalog','after-sales','reports','integrations','bi','comandas','ranking','fiscal'])$('#tab-'+name).hidden=name!==tab;
  document.querySelectorAll('[data-tab]').forEach(n=>n.classList.toggle('active',n.dataset.tab===tab));
  const meta={orders:['Pedidos','Acompanhe cada pedido, do primeiro contato à entrega.'],
   ranking:['Ranking anual','Classificação por categoria, sem divulgar valores.'],fiscal:['Fiscal e estornos','Solicitações e conciliação, sem execução externa.'],
   comandas:['Mesas e comandas','Controle do consumo no local.'],
   bi:['BI ao vivo','Visão executiva com atualização automática e modo TV.'],
   reports:['Relatórios gerenciais','Resultados comerciais e indicadores operacionais.'],integrations:['Integrações XTL','Ambiente técnico restrito.'],
   kitchen:['Fila da cozinha','Visão de superadmin'],courier:['Entregas','Visão de superadmin'],
   'after-sales':['Pós-venda','Acompanhe a satisfação 30 minutos após a entrega.'],
   customers:['Clientes','Cadastros e relacionamento com o cliente.'],
   cash:['Caixa diário','Conferência e fechamento dos pagamentos recebidos.'],
   catalog:['Preços do cardápio','Ajuste de valores, com histórico e autorização.']};
  $('#pageTitle').textContent=meta[tab][0];$('#pageSubtitle').textContent=meta[tab][1];
  if(S.data){
   renderTab();if(tab==='catalog')ensureCatalog();

  }
 }
 function render(){if(!S.data)return;if(S.data.operational){renderOperational();return;}$('#todayText').textContent='📅 '+S.data.today.split('-').reverse().join('/');
  $('#staffLabel').textContent=S.actor.email||'Atendente';
  $('#staffRole').textContent=S.actor.role==='admin'?'Superadministrador XTL':S.actor.role==='manager'?'Administração do estabelecimento':'Atendimento';
  document.querySelectorAll('[data-superadmin]').forEach(n=>n.hidden=S.actor.role!=='admin');
  document.querySelectorAll('[data-management]').forEach(n=>n.hidden=!['admin','manager'].includes(S.actor.role));
  $('#pendingCount').textContent=S.data.orders.filter(x=>['pending_customer','awaiting_acceptance'].includes(x.status)).length||'';
  renderTab();if(S.tab!=='after-sales')void refreshAfterSales();
 }
 function renderOperational(data=S.data,view=S.actor.role){
  const isAdmin=S.actor.role==='admin';
  const kitchen=view==='kitchen';
  $('#staffLabel').textContent=S.actor.email||'Equipe';
  $('#staffRole').textContent=isAdmin?'Superadministrador XTL':kitchen?'Cozinha':'Motoboy';
  $('#pageTitle').textContent=kitchen?'Fila da cozinha':'Entregas';
  $('#pageSubtitle').textContent=kitchen?'Pedidos aceitos e em preparo.':'Pedidos preparados e suas entregas em andamento.';
  $('#navigation').hidden=!isAdmin;
  for(const name of ['orders','customers','cash','catalog','after-sales','reports','integrations','bi','comandas','ranking','fiscal'])$('#tab-'+name).hidden=true;
  const section=$('#tab-operational');section.hidden=false;
  const list=$('#operationalQueue');clear(list);
  const orders=data.orders||[];
  if(!orders.length){list.append(el('p','Nenhum pedido disponível.','empty'));return;}
  for(const o of orders){
   const card=el('article',null,'form-card');
   card.append(el('h2','#'+o.ref_code+' · '+(label[o.status]||o.status)),el('p',time(o.created_at),'hint'));
   const move=async(next,reason)=>{
    try{await run(isAdmin?'operational_status':'order_status',{id:o.request_id,next,reason,...(isAdmin?{view}:{})});await reload();show('Pedido atualizado.');}
    catch(e){show(e.message,true);}
   };
   if(kitchen){
    card.append(el('p',({delivery:'Entrega',pickup:'Retirada',table:'Mesa'}[o.mode]||'')+(o.table_name?' · '+o.table_name:'')));
    for(const i of o.items||[]){
     card.append(el('h3',i.quantity+'x '+i.product+(i.option&&i.option!=='Único'?' · '+i.option:'')));
     const details=[i.flavors?.join(' / '),i.freeExtras?.join(', '),i.paidExtras?.join(', '),i.note].filter(Boolean).join(' · ');
     if(details)card.append(el('p',details));
    }
    if(o.note)card.append(el('p','Observação: '+o.note));
    if(o.status==='accepted')card.append(button('Iniciar preparo',()=>move('preparing'),'soft'));
    card.append(button('Pedido preparado',()=>move('completed'),'primary'));
    card.append(button('Devolver ao atendimento',()=>{
      const reason=prompt('Informe o motivo da devolução ao atendente:');
      if(reason?.trim())move('returned_to_attendant',reason.trim());
    },'soft danger'));
   }else{
    const f=o.fulfillment||{};
    const address=[f.street,f.number,f.neighborhood,f.city,'RS',f.postalCode].filter(Boolean).join(', ');
    card.append(el('h3',o.customer_name||'Cliente'),el('p',address),el('p',[f.complement,f.reference].filter(Boolean).join(' · ')));
    if(/^\d{10,11}$/.test(o.customer_phone||'')){
     const phone=el('a','Ligar: '+o.customer_phone);phone.href='tel:+55'+o.customer_phone;card.append(phone);
     card.append(button('WhatsApp',()=>window.open('https://wa.me/55'+o.customer_phone,'_blank','noopener,noreferrer')));
    }
    const lat=f.location?.latitude,lon=f.location?.longitude;
    const dest=Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lon)&&Math.abs(lon)<=180?lat+','+lon:address;
    const map=el('a','Abrir rota no Google Maps');map.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(dest);map.target='_blank';map.rel='noopener noreferrer';card.append(map);
    if(o.status==='completed')card.append(button('Sair para entrega',()=>move('out_for_delivery'),'primary'));
    if(o.status==='out_for_delivery')card.append(button('Confirmar entrega',()=>{if(confirm('Confirma que entregou este pedido?'))move('delivered');},'primary'));
   }
   list.append(card);
  }
 }
 let afterSalesBusy=false, previousDue=0;
 async function refreshAfterSales(){
  if(afterSalesBusy||S.demo||!S.actor||S.data?.operational||document.hidden)return;
  const actor=S.actor;
  afterSalesBusy=true;
  try{
   const data=await request('/api/backoffice?action=after_sales');
   if(S.actor!==actor)return;
   const tasks=data.tasks||[];
   const due=tasks.filter(t=>t.state==='pending'&&t.due).length;
   $('#afterSalesCount').textContent=due||'';
   if(due>previousDue&&S.tab!=='after-sales')show('Pós-venda disponível: '+due+' pedido(s). Abra a fila.');
   previousDue=due;
   if(S.tab!=='after-sales')return;
   const list=$('#afterSalesQueue');clear(list);
   if(!tasks.length){list.append(el('p','Nenhuma tarefa de pós-venda.','empty'));return;}
   for(const t of tasks){
    const card=el('article',null,'form-card');
    const state={pending:t.due?'Contato disponível':'Aguardando 30 minutos',claimed:'Em atendimento',contacted:'Aguardando resposta',issue:'Problema relatado'};
    card.append(el('h3','#'+t.ref_code+' · '+state[t.state]),el('p',t.customer_name||'Cliente'),el('p','Contato previsto: '+new Date(t.due_at).toLocaleString('pt-BR')));
    if(t.review_due)card.append(el('p',t.review_requested_at?'Convite de avaliação registrado':'⭐ 3ª entrega — convidar para avaliação no Google','hint'));
    if(t.note)card.append(el('p',t.note));
    const move=async(next,note='')=>{
     try{await run('after_sale_status',{id:t.request_id,next,note});await refreshAfterSales();show('Pós-venda atualizado.');}catch(e){show(e.message,true);}
    };
    if(t.state==='pending'&&t.due)card.append(button('Assumir pós-venda',()=>move('claimed'),'primary'));
    if(t.state==='claimed'&&t.mine){
     if(/^\d{10,11}$/.test(t.customer_phone||'')){
      const link=el('a','💬 Perguntar pelo WhatsApp');
      let message='Olá! Aqui é o Disk Panquecão. Seu pedido chegou certinho? Deu tudo certo com o atendimento e a comida? 😊';
      if(t.review_due)message+='\n\nObrigado por pedir com a gente novamente! Se quiser, conte sua experiência sincera em uma avaliação do Disk Panquecão no Google.'+(data.reviewUrl?' '+data.reviewUrl:'');
      link.href='https://wa.me/55'+t.customer_phone+'?text='+encodeURIComponent(message);
      link.target='_blank';link.rel='noopener noreferrer';card.append(link);
     }
     card.append(button(t.review_due?'Confirmar pós-venda e convite enviados':'Confirmar mensagem enviada',()=>move('contacted'),'primary'),button('Liberar tarefa',()=>move('pending')));
    }
    if(t.state==='contacted'&&t.mine){
     card.append(button('Tudo certo',()=>move('satisfied'),'primary'),button('Sem resposta',()=>move('no_response')));
     card.append(button('Relatou problema',()=>{const note=prompt('Qual problema o cliente relatou?');if(note?.trim())move('issue',note.trim());},'soft danger'));
    }
    if(t.state==='issue'&&t.mine)card.append(button('Resolver e concluir',()=>{const note=prompt('Registre como o problema foi resolvido:');if(note?.trim())move('satisfied',note.trim());},'primary'));
    list.append(card);
   }
  }catch(e){if(S.tab==='after-sales')show(e.message,true);}
  finally{afterSalesBusy=false;}
 }
 async function adminOperational(view){
  if(S.actor?.role!=='admin'||S.demo)return;
  const actor=S.actor;
  try{const data=await request('/api/backoffice?action=operational_queue&view='+view);if(S.actor===actor&&S.tab===view)renderOperational(data,view);}catch(e){show(e.message,true);}
 }
 let reportBusy=false, reportData=null;
 function reportRows(title,headers,rows){
  const section=el('section',null,'form-card');section.append(el('h3',title));
  if(!rows.length){section.append(el('p','Sem registros no período.','hint'));return section;}
  const wrap=el('div',null,'table-wrap'),table=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');
  headers.forEach(h=>tr.append(el('th',h)));head.append(tr);
  rows.forEach(row=>{const line=el('tr');row.forEach(v=>line.append(el('td',v==null?'—':String(v))));body.append(line);});
  table.append(head,body);wrap.append(table);section.append(wrap);return section;
 }
 const reportMoney=v=>money(Number(v||0)),reportMin=v=>v==null?'Sem dados':Number(v).toLocaleString('pt-BR')+' min';
 const reportRole={admin:'Superadministrador',manager:'Administração',attendant:'Atendimento',kitchen:'Cozinha',courier:'Motoboy',system:'Sistema'};
 const reportMode={delivery:'Entrega',pickup:'Retirada',table:'Mesa'};
 function reportSections(d){
  return [
   ['Vendas por dia',['Data','Pedidos pagos','Receita'],d.days.map(x=>[x.day,x.orders,reportMoney(x.revenue_cents)])],
   ['Meios de pagamento',['Meio','Pedidos','Receita'],d.methods.map(x=>[payment[x.payment_method]||x.payment_method,x.orders,reportMoney(x.revenue_cents)])],
   ['Modalidades',['Modalidade','Pedidos','Receita'],d.types.map(x=>[reportMode[x.mode]||x.mode,x.orders,reportMoney(x.revenue_cents)])],
   ['Situação dos pedidos recebidos',['Status atual','Pedidos','Valor nominal'],d.states.map(x=>[label[x.status]||x.status,x.orders,reportMoney(x.order_value_cents)])],
   ['Produtos mais vendidos (até 100)',['Produto','Tamanho','Quantidade','Receita de produtos'],d.products.map(x=>[x.product,x.variant,x.quantity,reportMoney(x.revenue_cents)])],
   ['Pós-venda por vencimento',['Situação','Tarefas','Contatados','Convites Google','Atrasados'],d.followup.map(x=>[({pending:'Pendente',claimed:'Assumido',contacted:'Contatado',issue:'Problema',satisfied:'Concluído',no_response:'Sem resposta'})[x.state]||x.state,x.tasks,x.contacted,x.review_invites,x.overdue])],
   ['Fechamento de caixa',['Data','Dinheiro contado','Diferença','Receita registrada'],d.closings.map(x=>[x.day,reportMoney(x.counted_cash_cents),reportMoney(x.discrepancy_cents),reportMoney(x.summary?.total_cents)])],
   ['Comandas abertas no período',['Situação atual','Comandas','Mesas distintas'],(d.tabs||[]).map(x=>[x.state==='open'?'Aberta':'Fechada',x.tabs,x.tables])],
   ['Alterações de preço (até 100)',['Produto','Opção','Anterior','Novo','Data'],d.prices.map(x=>[x.product,x.variant,x.old_price,x.new_price,new Date(x.changed_at).toLocaleString('pt-BR')])],
   ...(d.technical?[
    ['Perfis da equipe',['Perfil','Ativo','Contas'],d.technical.staff.map(x=>[reportRole[x.role]||x.role,x.active?'Sim':'Não',x.total])],
    ['Atividade por operador',['Perfil','Operador','Alterações'],d.technical.activity.map(x=>[reportRole[x.role]||x.role,x.operator,x.changes])],
    ['Transições auditadas',['Anterior','Novo','Quantidade'],d.technical.events.map(x=>[label[x.previous_status]||x.previous_status,label[x.next_status]||x.next_status,x.transitions])]
   ]:[])
  ];
 }
 function renderReports(d){
  const target=$('#reportContent');clear(target);
  const sales=d.sales||{},ops=d.operations||{},clients=d.clients||{};
  const metrics=[['Receita recebida',reportMoney(sales.revenue_cents)],['Pedidos pagos e concluídos',sales.orders||0],
   ['Ticket médio',sales.orders?reportMoney(Math.round(Number(sales.revenue_cents)/sales.orders)):'—'],
   ['Receita de produtos',reportMoney(sales.products_cents)],['Taxas de entrega',reportMoney(sales.fees_cents)],
   ['Clientes compradores',sales.customers||0],['Clientes anteriores',clients.returning||0],['Recompraram no período',clients.repeat_in_period||0],
   ['Tempo médio até aceite',reportMin(ops.avg_accept_minutes)],['Tempo médio em entrega',reportMin(ops.avg_delivery_minutes)],
   ['Pedidos entregues sem pagamento',ops.delivered_unpaid||0],['Valor nominal pendente',reportMoney(ops.unpaid_cents)],
   ['PanqueCoins emitidas',d.coins?.enabled?reportMoney(d.coins.issued_cents):'Programa desativado']];
  const grid=el('div',null,'cash-grid');for(const [name,value] of metrics){const item=el('div',null,'cash-tile');item.append(el('small',name),el('strong',String(value)));grid.append(item);}target.append(grid);
  if(d.technical){target.append(el('p','Catálogo: '+d.technical.source+' · revisão '+(d.technical.catalog?.revision??'—')+' · Telegram pendente: '+(ops.telegram_pending||0)+' · envio incerto: '+(ops.telegram_uncertain||0),'hint'));}
  reportSections(d).forEach(([title,headers,rows])=>target.append(reportRows(title,headers,rows)));
  $('#reportExport').disabled=false;
 }
 async function refreshReports(){
  if(reportBusy||S.demo||!['manager','admin'].includes(S.actor?.role))return;
  const actor=S.actor,start=$('#reportStart'),end=$('#reportEnd');
  if(!start.value)start.value=S.data.today.slice(0,7)+'-01';if(!end.value)end.value=S.data.today;
  reportBusy=true;$('#reportExport').disabled=true;reportData=null;clear($('#reportContent'));$('#reportStatus').textContent='Carregando dados do Neon…';
  try{
   const result=await request('/api/backoffice?action=management_reports&start='+encodeURIComponent(start.value)+'&end='+encodeURIComponent(end.value));
   if(S.actor!==actor||S.tab!=='reports')return;reportData=result;renderReports(result);
   $('#reportStatus').textContent='Receita por data de liquidação; pedidos por data de entrada. '+result.period.from+' a '+result.period.to+'.';
  }catch(e){$('#reportStatus').textContent=e.message;}
  finally{reportBusy=false;}
 }
 function exportReports(){
  if(!reportData||!['admin','manager'].includes(S.actor?.role))return;
  const esc=v=>{let x=String(v??'');if(/^[=+@\-\t\r]/.test(x))x="'"+x;return '"'+x.replaceAll('"','""')+'"';};
  const rows=[['XTL FOOD',reportData.period.from,reportData.period.to],['Receita recebida',reportMoney(reportData.sales?.revenue_cents)],['Pedidos pagos e concluídos',reportData.sales?.orders||0]];
  for(const [title,headers,data] of reportSections(reportData))rows.push([], [title],headers,...data);
  const blob=new Blob(['\ufeff'+rows.map(row=>row.map(esc).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='xtl-food-relatorio-'+reportData.period.from+'-'+reportData.period.to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 let biBusy=false,biData=null,biLastOK=0,biPrivate=false;
 const biFmt=n=>Number(n||0).toLocaleString('pt-BR');
 const biMoney=n=>biPrivate?'••••':money(Number(n||0));
 const biMinutes=n=>n==null?'—':biFmt(n)+' min';
 function biMetric(label,value,financial=false){
  const card=el('div',null,'bi-metric');card.append(el('small',label),el('strong',financial&&biPrivate?'••••':String(value)));return card;
 }
 function biBars(title,rows,format,mask=false){
  const panel=el('article',null,'bi-panel');panel.append(el('h3',title));
  const max=Math.max(1,...rows.map(r=>Number(r[1])||0));
  if(!rows.length){panel.append(el('p','Sem registros','bi-muted'));return panel;}
  for(const [name,value] of rows){
   const row=el('div',null,'bi-bar-row'),line=el('div',null,'bi-bar-label');
   line.append(el('span',name),el('strong',mask&&biPrivate?'••••':format(value)));
   const track=el('progress');track.max=max;track.value=Math.max(0,Number(value)||0);
   track.setAttribute('aria-label',name);row.append(line);
   if(!(mask&&biPrivate))row.append(track);panel.append(row);
  }
  return panel;
 }
 function drawBI(data){
  const t=data.totals||{},f=data.followup||{},m=data.timing||{};
  const queue=Object.fromEntries((data.queue||[]).map(x=>[x.status,x.orders]));
  const q=(...states)=>states.reduce((n,k)=>n+Number(queue[k]||0),0);
  $('#biDate').textContent=(data.day||'').split('-').reverse().join('/')+' · Caixa '+(data.cash_closed?'fechado':'aberto');
  const cards=$('#biCards'),charts=$('#biCharts');clear(cards);clear(charts);
  const kpis=[['Receita de hoje',biMoney(t.revenue_cents),true],['Pedidos recebidos hoje',biFmt(m.received)],['Pagos e concluídos',biFmt(t.orders)],['Ticket médio',t.orders?biMoney(Math.round(Number(t.revenue_cents)/t.orders)):'—',true],['Clientes compradores',biFmt(t.customers)],['Em preparo',biFmt(q('accepted','preparing'))],['Em entrega',biFmt(q('out_for_delivery'))],['Pós-venda pendente',biFmt(f.due)],['Problemas em aberto',biFmt(f.issues)],['Tempo até aceite',biMinutes(m.accept_minutes)],['Tempo de entrega',biMinutes(m.delivery_minutes)],['Cancelados hoje',biFmt(m.cancelled)],['Mesas ocupadas',biFmt(data.occupied_tables)],['Comandas abertas',biFmt(data.open_tabs)]];
  for(const [label,value,financial] of kpis)cards.append(biMetric(label,value,financial));
  charts.append(biBars('Vendas dos últimos 7 dias',(data.daily||[]).map(x=>[x.day.slice(5).split('-').reverse().join('/'),x.revenue_cents]),biMoney,true));
  charts.append(biBars('Fila operacional agora',[['Aguardando confirmação',q('pending_customer','awaiting_acceptance')],['Cozinha',q('accepted','preparing')],['Devolvidos',q('returned_to_attendant')],['Preparados',q('completed')],['Em entrega',q('out_for_delivery')]],biFmt));
  charts.append(biBars('Meios de pagamento hoje',(data.methods||[]).map(x=>[payment[x.method]||x.method||'Não informado',x.revenue_cents]),biMoney,true));
  charts.append(biBars('Produtos mais vendidos hoje',(data.products||[]).map(x=>[x.product,x.quantity]),biFmt));
 }
 async function refreshBI(){
  if(biBusy||S.demo||S.tab!=='bi'||document.hidden||!['admin','manager'].includes(S.actor?.role))return;
  const actor=S.actor;biBusy=true;
  try{
   const d=await request('/api/backoffice?action=live_bi');
   if(S.actor!==actor||S.tab!=='bi')return;
   if(!d.totals||!d.generated_at)throw Error('Resposta de BI incompleta.');
   biData=d;biLastOK=Date.now();drawBI(d);
   $('#biStatus').textContent='● Atualizado '+new Date(d.generated_at).toLocaleTimeString('pt-BR');
   $('#biStatus').classList.remove('bi-stale');
  }catch(e){
   if(S.actor!==actor||S.tab!=='bi')return;
   if(/login|sessão|autorizad|exclusivo/i.test(e.message)){exitBiTV();biData=null;clear($('#biCards'));clear($('#biCharts'));loggedOut();return;}
   $('#biStatus').textContent=biLastOK?'⚠ Dados desatualizados · última atualização '+new Date(biLastOK).toLocaleTimeString('pt-BR'):'⚠ Indicadores indisponíveis';
   $('#biStatus').classList.add('bi-stale');
  }finally{biBusy=false;}
 }
 function exitBiTV(){
  document.body.classList.remove('bi-tv');$('#biFullscreen').textContent='Modo TV';
  if(document.fullscreenElement===document.documentElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});
 }
 async function toggleBiTV(){
  if(S.tab!=='bi'||!['admin','manager'].includes(S.actor?.role))return;
  if(document.body.classList.contains('bi-tv')){exitBiTV();return;}
  document.body.classList.add('bi-tv');$('#biFullscreen').textContent='Sair do modo TV';
  try{if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();}catch{/* CSS fullscreen remains available on TV browsers. */}
 }
 let comandaBusy=false;
 function resetComandaManual(){
  S.comandaId=null;const f=$('#manualForm');for(const key of ['name','phone','type','table'])f.elements[key].disabled=false;
  $('#manualComandaHint').hidden=true;
 }
 async function addComandaOrder(tab){
  await ensureCatalog();if(!S.data?.catalog?.catalog)return show('Catálogo indisponível.',true);
  resetComandaManual();const f=$('#manualForm');f.reset();await fillManual();
  S.comandaId=tab.id;f.elements.name.value=tab.customer_name||'';f.elements.phone.value='';f.elements.type.value='table';f.elements.table.value=String(tab.table_number);
  for(const key of ['name','phone','type','table'])f.elements[key].disabled=true;
  $('#manualComandaHint').hidden=false;$('#manualComandaHint').textContent='Lançamento na mesa '+tab.table_number+' · CPF final '+tab.cpf_suffix;
  updateManualType();openDialog('manualDialog');
 }
 async function refreshComandas(){
  if(comandaBusy||S.demo||!S.actor||S.data?.operational||S.tab!=='comandas')return;comandaBusy=true;
  const actor=S.actor;
  try{
   const d=await request('/api/backoffice?action=comandas');if(S.actor!==actor||S.tab!=='comandas')return;
   $('#comandaStatus').textContent=d.cpfEnabled?'CPF protegido · uma comanda aberta por CPF':'Abertura por CPF ainda não configurada.';
   $('#comandaFind').disabled=!d.cpfEnabled;$('#comandaOpen').disabled=!d.cpfEnabled||$('#comandaForm').dataset.ready!=='yes';
   const target=$('#comandaList');clear(target);
   if(!d.tabs.length)target.append(el('p','Nenhuma comanda aberta.','empty'));
   for(const t of d.tabs){
    const card=el('article',null,'form-card');card.append(el('h3','Mesa '+t.table_number+' · CPF final '+t.cpf_suffix),el('p',t.customer_name),el('p','Consumo: '+money(t.total_cents)+' · Pendente: '+money(t.pending_cents)),el('p',t.orders+' pedido(s) · '+t.unfinished+' não finalizado(s)','hint'));
    card.append(button('Lançar pedido',()=>addComandaOrder(t),'primary'));
    const close=button('Fechar comanda',async()=>{if(!confirm('Fechar esta comanda?'))return;try{await run('comanda_close',{id:t.id});await refreshComandas();show('Comanda fechada.');}catch(e){show(e.message,true);}});close.disabled=Number(t.unfinished)>0;card.append(close);target.append(card);
   }
  }catch(e){$('#comandaStatus').textContent=e.message;}finally{comandaBusy=false;}
 }
 let annualBusy=false;
 async function refreshAnnual(){
  if(annualBusy||S.demo||!['admin','manager'].includes(S.actor?.role)||!['ranking','fiscal'].includes(S.tab))return;
  const actor=S.actor,tab=S.tab;annualBusy=true;
  const root=$(tab==='ranking'?'#annualContent':'#fiscalContent');clear(root);
  try{
   if(tab==='ranking'){
    const d=await request('/api/backoffice?action=annual_ranking&year='+encodeURIComponent($('#annualYear').value));
    if(S.actor!==actor||S.tab!==tab)return;
    root.append(el('p',d.published?'Campanha publicada':'Campanha ainda não liberada · prévia administrativa','hint'));if(d.prize)root.append(el('p',d.prize));
    for(const [key,title] of [['pancake','Rei das Panquecas'],['orders','Cliente Fiel'],['visits','Cliente da Casa']]){
     root.append(reportRows(title,['Posição','Nome autorizado ou apelido'],d.entries.filter(e=>e.category===key).map(e=>[e.position+'º',e.alias])));
    }
   }else{
    const d=await request('/api/backoffice?action=fiscal_refunds');
    if(S.actor!==actor||S.tab!==tab)return;
    root.append(el('p','Registro interno. Emissão e transferência externas ainda não habilitadas.','hint'));
    root.append(reportRows('Solicitações fiscais',['Pedido ou comanda','Estado','Data'],d.fiscal.map(x=>[x.request_id||x.comanda_id,x.state,new Date(x.created_at).toLocaleString('pt-BR')])));
    root.append(reportRows('Solicitações de devolução Pix',['Pedido','Valor','Motivo','Estado'],d.refunds.map(x=>[x.ref_code,money(x.amount_cents),x.reason,x.state])));
   }
  }catch(e){if(S.actor===actor&&S.tab===tab)root.append(el('p',e.message,'hint'));}
  finally{annualBusy=false;}
 }
 function renderTab(){if(['ranking','fiscal'].includes(S.tab))void refreshAnnual();if(S.tab==='comandas')void refreshComandas();if(S.tab==='bi')void refreshBI();if(S.tab==='reports')void refreshReports();if(S.tab==='integrations')void refreshAsaas();if(['kitchen','courier'].includes(S.tab))void adminOperational(S.tab);if(S.tab==='orders')renderOrders();if(S.tab==='customers')renderCustomers();if(S.tab==='cash')renderCash();if(S.tab==='catalog')renderCatalog();if(S.tab==='after-sales')refreshAfterSales();}
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
   (counts.accepted||0)+(counts.preparing||0)+(counts.returned_to_attendant||0)+(counts.completed||0)+(counts.out_for_delivery||0):orders.filter(o=>['accepted','preparing','returned_to_attendant','completed','out_for_delivery'].includes(o.status)).length);
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
 const scenarioLabel={pix:'Pix',credit_card:'Cartão',both:'Pix ou cartão'};
 const sandboxStatus={creating:'Em criação',active:'Ativo',paid:'Pago (simulado)',expired:'Expirado',canceled:'Cancelado',uncertain:'Conciliar'};
 async function refreshAsaasHistory(){
  const status=$('#asaasHistoryStatus'),checkouts=$('#asaasHistoryCheckouts'),events=$('#asaasHistoryEvents');
  clear(checkouts);clear(events);
  if(S.demo||S.actor?.role!=='admin'){status.textContent='';return;}
  const btn=$('#asaasHistoryRefresh');btn.disabled=true;status.textContent='Consultando registros do Sandbox...';
  try{
   const info=await request('/api/asaas-sandbox?view=history');
   if(info.mode!=='sandbox')throw Error('Ambiente inesperado.');
   if(S.demo||S.actor?.role!=='admin')return;
   for(const x of info.checkouts||[]){
    const row=el('tr');td(row,time(x.created_at));td(row,scenarioLabel[x.scenario]||'—');td(row,x.external_ref);
    td(row,(sandboxStatus[x.status]||'—')+(x.reviewed_at?' · revisado':''));checkouts.append(row);
   }
   for(const x of info.events||[]){
    const row=el('tr');td(row,time(x.processed_at));td(row,x.event_type);td(row,x.external_ref);
    td(row,sandboxStatus[x.status]||'—');events.append(row);
   }
   status.textContent=(info.checkouts?.length||0)+' checkout(s), '+(info.events?.length||0)+' evento(s) recebido(s).';
  }catch(e){status.textContent='Histórico indisponível. Consulte o painel oficial do Asaas.';}
  finally{btn.disabled=false;}
 }
 async function refreshAsaas(){
  const card=$('#asaasSandboxCard'),btn=$('#asaasSandboxCreate');
  if(S.demo||S.actor?.role!=='admin'){
   card.hidden=true;clear($('#asaasHistoryCheckouts'));clear($('#asaasHistoryEvents'));$('#asaasHistoryStatus').textContent='';return;
  }
  card.hidden=false;btn.disabled=true;
  try{
   const info=await request('/api/asaas-sandbox');
   const latest=info.recent?.[0];
   const unresolved=info.recent?.find(x=>x.status==='uncertain'&&!x.reviewed_at&&x.scenario===$('#asaasScenario').value);
   btn.disabled=!info.enabled||!!unresolved;
   const resolve=$('#asaasSandboxResolve');
   resolve.hidden=!unresolved;
   resolve.dataset.id=unresolved?.id||'';
   resolve.dataset.reference=unresolved?.external_ref||'';
   if(unresolved){
    $('#asaasSandboxLink').textContent='⚠️ Checkout pendente de conciliação no Asaas Sandbox. Referência: '+
     unresolved.external_ref+'. Não tente criar outro até confirmar que esta tentativa não existe no Asaas.';
   }
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
  if(!catalog){$('#catalogNotice').textContent='Carregando cardápio...';return;}
  const canEdit=['admin','manager'].includes(S.actor.role)&&(S.demo||S.data.catalogWritable!==false);
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
  if(o.return_reason)body.append(el('div','Devolvido pela cozinha: '+o.return_reason,'text-block'));
  if(o.note)body.append(el('div','Observação: '+o.note,'text-block'));
  const due=total(o),summary=el('div',null,'total-line');
  summary.append(el('span','Total previsto'),el('strong',due===null?'Entrega a confirmar':money(due)));body.append(summary);
  if(o.origin==='site'&&o.telegram_state!=='sent')body.append(el('p','⚠️ Telegram não confirmado; verifique o contato e o cupom antes do aceite.','hint'));
  if(customer&&!S.demo)actions.append(button('WhatsApp',()=>window.open('https://wa.me/55'+customer.phone,'_blank','noopener,noreferrer')));
  const choices={pending_customer:[['Cliente confirmou','awaiting_acceptance'],['Cancelar','cancelled']],
   awaiting_acceptance:[['Aceitar pedido','accepted'],['Cancelar','cancelled']],
   accepted:[['Iniciar preparo','preparing'],['Marcar preparado','completed'],['Cancelar','cancelled']],
   preparing:[['Marcar preparado','completed'],['Cancelar','cancelled']],
   returned_to_attendant:[['Revisar e reenviar para aceite','awaiting_acceptance'],['Cancelar','cancelled']],
   completed:o.fulfillment?.type==='delivery'?[['Cancelar','cancelled']]:[['Marcar entregue','delivered'],['Cancelar','cancelled']],
   out_for_delivery:[['Marcar entregue','delivered'],['Cancelar','cancelled']]};
  for(const [text,next] of choices[o.status]||[])actions.append(button(text,async()=>{
   if(next==='accepted'&&due===null)return show('Defina a taxa de entrega antes de aceitar.',true);
   if(next==='cancelled'&&o.payment_status==='paid')return show('Pedido pago exige estorno; não pode cancelar aqui.',true);
   if(['cancelled','delivered'].includes(next)&&!confirm('Confirmar: '+text.toLowerCase()+'?'))return;
   await mutate('order_status',{id,next},'Situação atualizada.');
  },next==='cancelled'?'soft danger':'primary'));
  if(['accepted','preparing','completed','out_for_delivery','delivered'].includes(o.status)&&o.payment_status==='pending'){
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
   if(action==='catalog_price'&&result?.catalog){S.data.catalog=result.catalog;S.catalogLoadedAt=Date.now();}
   await reload();closeDialog('detailDialog');closeDialog('customerDialog');closeDialog('priceDialog');closeDialog('manualDialog');if(action==='manual_order')resetComandaManual();show(S.demo?'DEMONSTRAÇÃO: '+success:success);}
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
  await fillProduct();
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
  if(!S.areas){try{S.areas=await staticData('/delivery-areas.json');}catch{S.areas={cities:{}};}}
  clear($('#manualNeighborhood'));
  for(const a of S.areas.cities?.[$('#manualCity').value]||[]){
   const option=el('option',a.name);option.value=a.name;$('#manualNeighborhood').append(option);
  }
 }
 function updateManualType(){
  const type=$('#manualForm').elements.type.value;
  $('#manualDelivery').hidden=type!=='delivery';$('#manualTable').hidden=type!=='table';
  if(type==='delivery')fillNeighborhood();
 }
 function parseMobilePrice(text){
  const match=/R\$\s*(\d+),(\d{2})/.exec(text||'');return match?Number(match[1])*100+Number(match[2]):null;
 }
 function loggedOut(){exitBiTV();biData=null;biLastOK=0;clear($('#biCards'));clear($('#biCharts'));S.actor=null;S.data=null;S.catalogLoadedAt=0;S.catalogPending=null;$('#appShell').hidden=true;$('#loginScreen').hidden=false;}
 async function boot(){
  $('#annualYear').addEventListener('change',refreshAnnual);
  if(!S.demo)setInterval(()=>{if(S.tab==='ranking'&&!document.hidden)void refreshAnnual();},300000);
  const cf=$('#comandaForm');
  function resetCpfLookup(){
   cf.elements.name.value='';cf.elements.phone.value='';cf.elements.name.required=false;cf.elements.phone.required=false;
   $('#comandaRegister').hidden=true;cf.elements.confirmExisting.checked=false;
   $('#comandaIdentity').textContent='Consulte o CPF para identificar o cliente.';$('#comandaOpen').disabled=true;
   cf.dataset.identified='';cf.dataset.ready='';
  }
  cf.elements.cpf.addEventListener('input',resetCpfLookup);
  $('#comandaFind').addEventListener('click',async()=>{
   const input=cf.elements.cpf,typed=input.value;resetCpfLookup();
   if(!typed.trim())return show('Informe o CPF do cliente.',true);
   try{
    const d=await run('comanda_customer',{cpf:typed});if(input.value!==typed)return;
    const x=d.customer;
    if(x?.tab_id){cf.reset();resetCpfLookup();await addComandaOrder({id:x.tab_id,customer_name:x.customer_name,table_number:x.table_number,cpf_suffix:x.cpf_suffix});return;}
    if(x){cf.dataset.identified='yes';$('#comandaIdentity').textContent='Cliente localizado: '+x.customer_name+' · CPF final '+x.cpf_suffix;}
    else{$('#comandaRegister').hidden=false;cf.elements.name.required=true;cf.elements.phone.required=true;$('#comandaIdentity').textContent='Primeira visita identificada por CPF. Complete o cadastro.';}
    cf.dataset.ready='yes';$('#comandaOpen').disabled=false;
   }catch(e){show(e.message,true);}
  });
  cf.addEventListener('submit',async e=>{
   e.preventDefault();if(cf.dataset.ready!=='yes')return show('Consulte o CPF primeiro.',true);
   $('#comandaOpen').disabled=true;
   try{
    const d=await run('comanda_open',{cpf:cf.elements.cpf.value,table:cf.elements.table.value,name:cf.elements.name.value,phone:cf.elements.phone.value,confirmExisting:cf.elements.confirmExisting.checked});
    cf.reset();resetCpfLookup();await refreshComandas();show('Comanda aberta.');await addComandaOrder(d.tab);
   }catch(err){show(err.message,true);$('#comandaOpen').disabled=false;}
  });
  $('#biFullscreen').addEventListener('click',toggleBiTV);
  $('#biPrivacy').addEventListener('click',()=>{biPrivate=!biPrivate;$('#biPrivacy').setAttribute('aria-pressed',String(biPrivate));$('#biPrivacy').textContent=biPrivate?'Mostrar valores':'Ocultar valores';if(biData)drawBI(biData);});
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.body.classList.contains('bi-tv'))exitBiTV();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.tab==='bi')void refreshBI();});
  if(!S.demo)setInterval(()=>{if(S.tab==='bi')void refreshBI();},30000);
  $('#reportForm').addEventListener('submit',e=>{e.preventDefault();void refreshReports();});
  $('#reportExport').addEventListener('click',exportReports);
  setInterval(()=>{if(S.actor&&!S.demo&&!S.data?.operational&&!document.hidden)void refreshAfterSales();},60000);
  // Poll only active operational screens; never reset an open dialog or search.
  if(!S.demo)setInterval(()=>{
   if(!S.actor||document.hidden||document.querySelector('dialog[open]'))return;
   if(S.data?.operational||['kitchen','courier'].includes(S.tab))void reload();
   else if(S.tab==='orders'&&!$('#orderSearch').value&&!$('#orderStatusFilter').value&&document.activeElement!==$('#orderSearch'))void reload();
  },30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshAfterSales();});
  for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>closeDialog(b.dataset.close));
  $('#navigation').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)showTab(b.dataset.tab);});
  $('#refresh').addEventListener('click',async()=>{await reload();if(S.tab==='catalog')await ensureCatalog(true);});
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
    resetComandaManual();
    await ensureCatalog();
    if(!S.data?.catalog?.catalog)return show('Catálogo indisponível.',true);
    $('#manualForm').reset();await fillManual();updateManualType();openDialog('manualDialog');
  });
  $('#manualForm').elements.type.addEventListener('change',updateManualType);
  $('#manualCity').addEventListener('change',fillNeighborhood);
  $('#manualCategory').addEventListener('change',fillProduct);
  $('#manualProduct').addEventListener('change',fillVariant);
  $('#countedCash').addEventListener('input',updateDifference);
  $('#asaasHistoryRefresh').addEventListener('click',refreshAsaasHistory);
  $('#asaasHistory').addEventListener('toggle',()=>{if($('#asaasHistory').open)refreshAsaasHistory();});
  $('#asaasScenario').addEventListener('change',()=>refreshAsaas());
  $('#asaasSandboxResolve').addEventListener('click',async()=>{
   const b=$('#asaasSandboxResolve'),reference=b.dataset.reference;
   if(!reference)return;
   const typed=prompt('Verifique primeiro no painel oficial do Asaas Sandbox que NÃO existe checkout para a referência '+reference+
    '. Para confirmar a ausência e liberar novo teste, digite exatamente a referência:');
   if(typed!==reference)return show('Reconciliação cancelada. Nenhum registro alterado.',true);
   b.disabled=true;
   try{
    await request('/api/asaas-sandbox',{action:'confirm_absent_sandbox_checkout',
     recordId:b.dataset.id,confirmation:'CONFIRMO_AUSENCIA_NO_ASAAS'});
    $('#asaasSandboxLink').textContent='Tentativa anterior revisada pela gestão; nenhuma cobrança real registrada.';
    show('Revisão registrada. Confira novamente a conexão Asaas antes de um novo checkout.');
   }catch(e){show(e.message,true);}
   finally{b.disabled=false;await refreshAsaas();}
  });
  $('#asaasSandboxProbe').addEventListener('click',async()=>{
   const b=$('#asaasSandboxProbe');b.disabled=true;
   const status=$('#asaasSandboxProbeStatus');status.textContent='Verificando conexão sem gerar cobrança...';
   try{
    const result=await request('/api/asaas-sandbox',{action:'check_sandbox_connection'});
    status.textContent=result.connected?'✅ Chave Sandbox aceita (HTTP '+result.httpStatus+').':
     '⚠️ Falha na conexão Sandbox ('+(result.httpStatus?'HTTP '+result.httpStatus:'rede')+
     ', código '+result.providerCode+'). Verifique sua API Key e as restrições da conta.';
   }catch(e){status.textContent='⚠️ Falha no teste de conexão: '+e.message;}
   finally{b.disabled=false;}
  });
  $('#asaasSandboxCreate').addEventListener('click',async()=>{
   const b=$('#asaasSandboxCreate');b.disabled=true;
   try{
    const scenario=$('#asaasScenario').value;
    const label={pix:'Pix',credit_card:'cartão de crédito',both:'Pix ou cartão'}[scenario];
    if(!label||!confirm('Criar checkout FICTÍCIO de R$ 5,00 ('+label+') no Asaas Sandbox?'))return;
    const result=await request('/api/asaas-sandbox',{action:'create_sandbox_checkout',scenario});
    const a=el('a','🔗 ABRIR CHECKOUT PIX/CARTÃO NO ASAAS');a.href=result.link;
    a.target='_blank';a.rel='noopener noreferrer';
    $('#asaasSandboxLink').replaceChildren(a);
    show('Checkout fictício criado. Toque no link destacado para abrir a página do Asaas.');
   }catch(e){
    $('#asaasSandboxLink').textContent='⚠️ '+e.message;
    show(e.message,true);
   }
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
   await mutate('manual_order',{name:f.elements.name.value,phone:f.elements.phone.value,...(S.comandaId?{comandaId:S.comandaId}:{}),
    fulfillment,lines:[line],note:$('#manualNote').value},'Pedido manual criado.');
  });
  $('#logout').addEventListener('click',async()=>{
   if(!S.demo)try{await run('logout',{});}catch{}
   location.href='/backoffice/';
  });
  const otpForm=$('#otpForm'),passwordForm=$('#loginForm');
  $('#useEmailCode').addEventListener('click',()=>{
   passwordForm.hidden=true;otpForm.hidden=false;$('#useEmailCode').hidden=true;
   $('#usePassword').hidden=false;$('#loginError').textContent='';
   $('#otpEmail').value=$('#email').value;$('#otpEmail').focus();
  });
  $('#usePassword').addEventListener('click',()=>{
   otpForm.hidden=true;passwordForm.hidden=false;$('#useEmailCode').hidden=false;
   $('#usePassword').hidden=true;$('#loginError').textContent='';
   $('#email').value=$('#otpEmail').value;$('#email').focus();
  });
  $('#sendOtp').addEventListener('click',async()=>{
   $('#loginError').textContent='';
   if(!$('#otpEmail').checkValidity())return $('#otpEmail').reportValidity();
   const btn=$('#sendOtp');btn.disabled=true;
   try{
    await run('request_otp',{email:$('#otpEmail').value.trim()});
    $('#otpInstruction').textContent='Se o e-mail estiver autorizado, enviaremos um código temporário. Confira a caixa de entrada e o spam. Um novo envio poderá ser solicitado após o intervalo de segurança.';
    $('#otpCode').disabled=false;$('#otpCodeWrap').hidden=false;$('#verifyOtp').hidden=false;$('#otpCode').focus();
   }catch(err){$('#loginError').textContent=err.message;}
   finally{btn.disabled=false;}
  });
  otpForm.addEventListener('submit',async e=>{
   e.preventDefault();$('#loginError').textContent='';
   if(!otpForm.reportValidity())return;
   const btn=$('#verifyOtp');btn.disabled=true;
   try{
    const result=await run('login_otp',{email:$('#otpEmail').value.trim(),otp:$('#otpCode').value.trim()});
    S.actor=result.actor;$('#loginScreen').hidden=true;$('#appShell').hidden=false;await reload();
    $('#otpCode').value='';
   }catch(err){$('#loginError').textContent=err.message;}
   finally{btn.disabled=false;}
  });
  $('#loginForm').addEventListener('submit',async e=>{
   e.preventDefault();$('#loginError').textContent='';
   try{const response=await run('login',{email:$('#email').value,password:$('#password').value});
    S.actor=response.actor;$('#loginScreen').hidden=true;$('#appShell').hidden=false;await reload();
   }catch(err){$('#loginError').textContent=err.message;}
  });
  if(S.demo){
   S.data=sample(null);
   S.actor={role:'manager',email:'demonstracao@exemplo.invalid'};$('#loginScreen').hidden=true;$('#appShell').hidden=false;
   $('#demoRibbon').hidden=false;render();return;
  }
  // Uma única consulta quando existe sessão: dashboard já autentica e retorna o ator.
  try{
   const next=await request('/api/backoffice?action=dashboard');
   S.actor=next.actor;S.data=next;S.moreOrders=next.orders.length>=80;
   $('#loginScreen').hidden=true;$('#appShell').hidden=false;render();
  }catch{
   // Sem sessão, diferencia a ausência de configuração sem atrasar o painel autenticado.
   try{const status=await request('/api/backoffice?action=status');
    if(!status.enabled){$('#setupNotice').hidden=false;$('#loginForm').querySelector('button[type=submit]').disabled=true;$('#useEmailCode').disabled=true;}
   }catch{/* A tela de login permanece visível. */}
  }
 }
 boot().catch(err=>{$('#loginError').textContent='Não foi possível iniciar o painel: '+err.message;});
})();
