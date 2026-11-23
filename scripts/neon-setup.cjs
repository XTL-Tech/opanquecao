'use strict';
// Migração intencionalmente explícita, não roda em build/deploy Vercel.
// Requer DATABASE_URL_UNPOOLED (Neon dedicado) e NEON_SETUP_CONFIRM=opanquecao.
// DRY RUN: node scripts/neon-setup.cjs --dry-run
const fs=require('node:fs');
const path=require('node:path');
function splitSql(source){
 const pieces=[];let buffer='',quote='',line=false,block=false,dollar='';
 for(let i=0;i<source.length;i++){
  const ch=source[i],nx=source[i+1];
  if(line){if(ch==='\n'){line=false;buffer+=ch;}continue;}
  if(block){if(ch==='*'&&nx==='/'){block=false;i++;}continue;}
  if(dollar){if(source.startsWith(dollar,i)){buffer+=dollar;i+=dollar.length-1;dollar='';}else buffer+=ch;continue;}
  if(quote){buffer+=ch;if(ch===quote){
   if(nx===quote){buffer+=nx;i++;}else quote='';
  }continue;}
  if(ch==='-'&&nx==='-'){line=true;i++;continue;}
  if(ch==='/'&&nx==='*'){block=true;i++;continue;}
  if(ch==='"'||ch==="'"){quote=ch;buffer+=ch;continue;}
  if(ch==='$'){
   const token=/^\$[a-zA-Z_0-9]*\$/.exec(source.slice(i));
   if(token){dollar=token[0];buffer+=dollar;i+=dollar.length-1;continue;}
  }
  if(ch===';'){if(buffer.trim())pieces.push(buffer.trim());buffer='';continue;}
  buffer+=ch;
 }
 if(buffer.trim())pieces.push(buffer.trim());
 return pieces;
}
async function main(){
 const sqlText=fs.readFileSync(path.resolve('neon/migrations/001_backoffice.sql'),'utf8');
 const statements=splitSql(sqlText).filter(x=>!['begin','commit'].includes(x.toLowerCase()));
 if(statements.length<20)throw Error('Parser SQL incompleto: menos de 20 declarações.');
 if(process.argv.includes('--dry-run')){
  console.log('DRY-RUN Neon: '+statements.length+' instruções, sem conectar ao banco.');return;
 }
 if(process.env.NEON_SETUP_CONFIRM!=='opanquecao')throw Error('Defina NEON_SETUP_CONFIRM=opanquecao para autorizar execução.');
 const url=process.env.DATABASE_URL_UNPOOLED;
 if(!url||!/^postgres(ql)?:\/\/.+@.+\.neon\.tech\//.test(url))throw Error('DATABASE_URL_UNPOOLED deve apontar para o Neon EXCLUSIVO do restaurante.');
 const {neon}=require('@neondatabase/serverless');const db=neon(url);
 for(let i=0;i<statements.length;i++){
  try{await db.query(statements[i]);}
  catch(e){throw Error('Migração interrompida na instrução '+(i+1)+' / '+statements.length+': '+e.message);}
 }
 const catalog=JSON.parse(fs.readFileSync('cardapio.json','utf8'));
 if(!Array.isArray(catalog.categorias)||catalog.categorias.length!==12)throw Error('Catálogo incompleto; seed cancelado.');
 const count=catalog.categorias.reduce((n,x)=>n+x.itens.length,0);
 if(count!==82)throw Error('Catálogo exige 82 produtos.');
 await db.query('INSERT INTO dp.catalog(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING',['opanquecao',JSON.stringify(catalog)]);
 const verification=await db.query("SELECT (SELECT count(*)::integer FROM dp.catalog) AS catalogs,(SELECT count(*)::integer FROM dp.orders) AS orders");
 console.log('Migração Neon concluída. Catálogos: '+verification[0].catalogs+'; pedidos atuais: '+verification[0].orders+'. Nenhuma senha/cadastro de gestor criado.');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={splitSql};
