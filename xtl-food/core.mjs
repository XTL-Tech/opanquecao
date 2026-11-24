// XTL FOOD — deterministic in-memory demonstration; no operational services.
export const ROLES=['manager','waiter','kitchen','bar','dispatch','courier','cashier','stock','accountant'];
export const MODULES=[
 ['overview','Visão geral',['manager']],['pos','PDV / comandas',['manager','waiter','cashier']],
 ['kitchen','Cozinha',['manager','kitchen']],['bar','Copa',['manager','bar']],
 ['dispatch','Expedição',['manager','dispatch']],['courier','Motoboy',['manager','courier']],
 ['billing','Cobrança',['manager','cashier']],['cash','Caixa / fechamento',['manager','cashier']],
 ['fiscal','Fiscal',['manager','accountant']],['stock','Estoque',['manager','stock']],
 ['purchase','Compras',['manager','stock']],['menu','Cardápio / fichas',['manager','stock']],
 ['crm','Clientes / fidelidade',['manager','waiter']],['finance','Financeiro',['manager','accountant']],
 ['bi','Indicadores',['manager']],['devices','Equipamentos',['manager','cashier','kitchen','bar','dispatch']],
 ['point','Ponto',ROLES],['admin','Administração',['manager']],['connect','Integrações',['manager']]
];
export const CATALOG=[
 {id:'p1',name:'Panqueca de frango',price:3290,cost:1150,station:'kitchen',recipe:{massa:1,frango:1}},
 {id:'p2',name:'Panqueca de carne',price:3590,cost:1300,station:'kitchen',recipe:{massa:1,carne:1}},
 {id:'p3',name:'Refrigerante',price:690,cost:260,station:'bar',recipe:{bebida:1}},
 {id:'p4',name:'Açaí',price:1790,cost:650,station:'bar',recipe:{acai:1}}
];
const num=(v)=>{if(!Number.isSafeInteger(v)||v<=0)throw Error('Informe um valor inteiro positivo.');return v;};
const text=(v)=>String(v??'').trim().slice(0,120);
const role=(s,module)=>{const m=MODULES.find(x=>x[0]===module);if(!m||!m[2].includes(s.role))throw Error('Acesso não autorizado neste perfil demonstrativo.');};
const find=(a,id)=>{const x=a.find(v=>v.id===id);if(!x)throw Error('Registro não encontrado.');return x;};
const add=(s,k,detail)=>s.audit.unshift({at:new Date().toISOString(),actor:s.role,event:k,detail:text(detail)});
export function initial(){return{demo:true,role:'manager',sequence:1,menu:structuredClone(CATALOG),
 tables:Array.from({length:8},(_,i)=>({id:'M'+(i+1),name:'Mesa '+(i+1)})),
 orders:[],stock:{massa:60,frango:40,carne:40,bebida:50,acai:30},purchases:[],customers:[{id:'C1',name:'Cliente exemplo',points:0}],
 cash:{open:false,opening:0,movements:[],closures:[]},fiscal:[],printJobs:[],point:[],audit:[]};}
export const total=o=>o.items.reduce((n,i)=>n+i.unit*i.qty,0);
export const paid=o=>o.payments.reduce((n,p)=>n+p.value,0);
export const balance=o=>total(o)-paid(o);
export const active=o=>!['closed','canceled'].includes(o.status);
export const ready=o=>o.items.length>0&&o.items.every(i=>i.status==='ready');
export function splitEqual(cents,people){num(people);if(people>20||cents<0||!Number.isSafeInteger(cents))throw Error('Divisão inválida.');return Array.from({length:people},(_,i)=>Math.floor(cents/people)+(i<cents%people?1:0));}
export function distance(a,b){const rad=x=>x*Math.PI/180;const dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon);return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2)));}
export function execute(s,action,p={}){
 if(s.demo!==true)throw Error('Somente demonstração.');
 const order=()=>find(s.orders,p.id);
 switch(action){
 case 'role':if(!ROLES.includes(p.role))throw Error('Perfil inválido.');s.role=p.role;return s;
 case 'openOrder':{role(s,'pos');if(!['table','pickup','delivery'].includes(p.type))throw Error('Modalidade inválida.');
  if(p.type==='table'){find(s.tables,p.table);if(s.orders.some(o=>active(o)&&o.table===p.table))throw Error('Mesa já possui comanda ativa.');}
  const id='D'+s.sequence++;s.orders.unshift({id,type:p.type,table:p.type==='table'?p.table:null,customer:text(p.customer)||'Cliente fictício',route:p.type==='delivery'?text(p.route)||'Endereço de teste':null,status:'open',items:[],payments:[],courier:null});add(s,action,id);return id;}
 case 'item':{role(s,'pos');const o=order();if(o.status!=='open')throw Error('Comanda encerrada para novos itens.');const m=find(s.menu,p.product),qty=num(p.qty);if(qty>20)throw Error('Quantidade máxima: 20.');
  for(const [k,v] of Object.entries(m.recipe))if(s.stock[k]<v*qty)throw Error('Estoque insuficiente: '+k);
  for(const [k,v] of Object.entries(m.recipe))s.stock[k]-=v*qty;
  o.items.push({id:'I'+s.sequence++,product:m.id,name:m.name,station:m.station,qty,unit:m.price,cost:m.cost,status:'queued'});add(s,action,o.id);break;}
 case 'send':{role(s,'pos');const o=order();if(o.status!=='open'||!o.items.length)throw Error('Inclua itens antes de enviar.');o.status='production';add(s,action,o.id);break;}
 case 'stage':{const o=order(),i=find(o.items,p.item);role(s,i.station);if(o.status!=='production')throw Error('Pedido não está em produção.');const next={queued:'preparing',preparing:'ready'}[i.status];if(!next)throw Error('Item já pronto.');i.status=next;if(ready(o))o.status='ready';add(s,action,i.id);break;}
 case 'dispatch':{role(s,'dispatch');const o=order();if(o.status!=='ready'||!ready(o))throw Error('Aguarde cozinha e copa.');o.status=o.type==='delivery'?'assigned':'served';if(o.type==='delivery')o.courier='Motoboy demo';add(s,action,o.id);break;}
 case 'delivery':{role(s,'courier');const o=order();if(o.type!=='delivery'||!o.courier)throw Error('Entrega não atribuída.');const next={assigned:'onroute',onroute:'served'}[o.status];if(!next)throw Error('Transição inválida.');o.status=next;add(s,action,o.id);break;}
 case 'cashOpen':role(s,'cash');if(s.cash.open)throw Error('Caixa já aberto.');if(!Number.isSafeInteger(p.value)||p.value<0)throw Error('Valor inválido.');s.cash.open=true;s.cash.opening=p.value;s.cash.movements=[];add(s,action,p.value);break;
 case 'pay':{role(s,'billing');const o=order(),value=num(p.value);if(!s.cash.open)throw Error('Abra o caixa.');if(o.status!=='served'||value>balance(o)||!['pix','card','cash'].includes(p.method))throw Error('Pagamento inválido ou pedido não servido.');o.payments.push({value,method:p.method});s.cash.movements.push({type:'payment',method:p.method,value,ref:o.id});if(balance(o)===0){o.status='closed';const customer=s.customers.find(c=>c.name===o.customer);if(customer)customer.points+=Math.floor(total(o)/100);}add(s,action,o.id);break;}
 case 'cashMove':role(s,'cash');if(!s.cash.open||!['supply','withdraw'].includes(p.type))throw Error('Movimento inválido.');{const value=num(p.value);if(p.type==='withdraw'&&value>cashExpected(s))throw Error('Saldo insuficiente.');s.cash.movements.push({type:p.type,method:'cash',value,ref:'manual'});add(s,action,p.type);}break;
 case 'cashClose':role(s,'cash');if(!s.cash.open||!Number.isSafeInteger(p.value)||p.value<0)throw Error('Fechamento inválido.');if(s.orders.some(o=>o.status==='served'&&balance(o)>0))throw Error('Existem contas servidas pendentes.');{const expected=cashExpected(s);s.cash.closures.unshift({at:new Date().toISOString(),expected,counted:p.value,difference:p.value-expected,report:cashSummary(s)});s.cash.open=false;add(s,action,p.value);}break;
 case 'fiscal':{role(s,'fiscal');const o=order();if(o.status!=='closed'||s.fiscal.some(f=>f.order===o.id))throw Error('Pedido não quitado ou já registrado.');s.fiscal.unshift({id:'SIM-'+s.sequence++,order:o.id,kind:p.kind==='nfse'?'NFS-e simulada':'NFC-e simulada',value:total(o),status:'SEM VALOR FISCAL'});add(s,action,o.id);break;}
 case 'inventory':role(s,'stock');if(!Object.hasOwn(s.stock,p.key)||!Number.isSafeInteger(p.qty)||p.qty===0||s.stock[p.key]+p.qty<0)throw Error('Movimento inválido.');s.stock[p.key]+=p.qty;add(s,action,p.key);break;
 case 'purchase':role(s,'purchase');if(!Object.hasOwn(s.stock,p.key))throw Error('Ingrediente inválido.');s.purchases.unshift({id:'PC'+s.sequence++,key:p.key,qty:num(p.qty),supplier:text(p.supplier)||'Fornecedor fictício',cost:num(p.cost),status:'ordered'});add(s,action,p.key);break;
 case 'receive':{role(s,'purchase');const x=find(s.purchases,p.id);if(x.status!=='ordered')throw Error('Compra já recebida.');s.stock[x.key]+=x.qty;x.status='received';add(s,action,x.id);break;}
 case 'price':role(s,'menu');find(s.menu,p.id).price=num(p.value);add(s,action,p.id);break;
 case 'customer':role(s,'crm');if(!text(p.name))throw Error('Nome obrigatório.');s.customers.push({id:'C'+s.sequence++,name:text(p.name),points:0});add(s,action,p.name);break;
 case 'print':role(s,'devices');if(!['58','80'].includes(p.width)||!['kitchen','bar','dispatch','cash'].includes(p.station))throw Error('Configuração inválida.');if(p.id)find(s.orders,p.id);{const key=[p.id||'test',p.station,p.width].join(':');if(s.printJobs.some(j=>j.key===key))throw Error('Prévia já gerada para este setor.');s.printJobs.unshift({id:'P'+s.sequence++,key,order:p.id||'TESTE',width:p.width,station:p.station,status:'Prévia — sem hardware'});add(s,action,key);}break;
 case 'point':{role(s,'point');const last=s.point.find(x=>x.user===s.role&&x.status==='accepted'),next={undefined:'entry',entry:'break_start',break_start:'break_end',break_end:'exit',exit:'entry'}[last?.kind];
  const loc=p.location,valid=loc&&Number.isFinite(loc.lat)&&Number.isFinite(loc.lon)&&Math.abs(loc.lat)<=90&&Math.abs(loc.lon)<=180,meters=valid?distance({lat:-29.60,lon:-50.90},loc):null;
  const requested=p.kind||next,ok=Number.isFinite(meters)&&meters<=100&&requested===next;
  s.point.unshift({id:'T'+s.sequence++,user:s.role,kind:requested,at:new Date().toISOString(),meters:meters===null?null:Math.round(meters),status:ok?'accepted':'review'});add(s,action,ok?'simulado':'revisar');break;}
 default:throw Error('Ação desconhecida.');
 }return s;
}
export function cashExpected(s){return s.cash.opening+s.cash.movements.filter(m=>m.method==='cash').reduce((n,m)=>n+(m.type==='withdraw'?-m.value:m.value),0);}
export function cashSummary(s){return Object.fromEntries(['cash','pix','card'].map(k=>[k,s.cash.movements.filter(m=>m.type==='payment'&&m.method===k).reduce((n,m)=>n+m.value,0)]));}
export function metrics(s){const closed=s.orders.filter(o=>o.status==='closed');return{revenue:closed.reduce((n,o)=>n+total(o),0),cost:closed.reduce((n,o)=>n+o.items.reduce((m,i)=>m+i.cost*i.qty,0),0),orders:closed.length,payables:s.purchases.filter(p=>p.status==='received').reduce((n,p)=>n+p.cost,0),pending:s.orders.filter(active).reduce((n,o)=>n+balance(o),0)};}
