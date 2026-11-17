// Checagem read-only da mesma tabela de catálogo usada pelo site.
// Sem segredos na URL ou resposta; evita cache para medir acesso real ao banco.
// A consulta periódica ajuda a detectar indisponibilidade, mas não garante
// que o Supabase Free nunca pausará o projeto.
module.exports = async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if(req.method!=='GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
    const url=process.env.SUPABASE_URL;
    const key=process.env.SUPABASE_PUBLISHABLE_KEY;
    if(!url||!key||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)){
        return res.status(503).json({ok:false,status:'not_configured'});
    }
    try{
        const response=await fetch(url+'/rest/v1/restaurant_catalogs?select=restaurant_id&restaurant_id=eq.opanquecao&limit=1',{
            method:'GET',cache:'no-store',
            headers:{apikey:key,Accept:'application/json'},
            signal:AbortSignal.timeout(7500)
        });
        if(!response.ok){
            console.warn(JSON.stringify({event:'catalog_health',ok:false,upstreamStatus:response.status}));
            return res.status(503).json({ok:false,status:'database_unavailable'});
        }
        const data=await response.json();
        if(!Array.isArray(data)||data.length!==1||data[0].restaurant_id!=='opanquecao'){
            return res.status(503).json({ok:false,status:'catalog_missing'});
        }
        res.status(200).json({ok:true,status:'catalog_online'});
    }catch(error){
        console.warn(JSON.stringify({event:'catalog_health',ok:false,reason:error?.name==='TimeoutError'?'timeout':'network'}));
        res.status(503).json({ok:false,status:'database_unavailable'});
    }
};
