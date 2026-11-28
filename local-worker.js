'use strict';
// Network-only PWA: never cache orders, sessions, API responses or personal data.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||e.request.mode!=='navigate')return;
 const u=new URL(e.request.url);if(u.origin!==self.location.origin||u.pathname!=='/local')return;
 e.respondWith(fetch(e.request).catch(()=>new Response('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>O Panquecão</title><main><h1>Sem conexão</h1><p>Conecte-se à internet para consultar a loja e enviar pedidos. Nenhum pedido foi enviado.</p><a href="/local">Tentar novamente</a></main></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
