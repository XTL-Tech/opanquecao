function error(message,status){return Object.assign(new Error(message),{status});}
export async function accountRequest(action,body=null,params={}){
 const query=new URLSearchParams({action,...params});
 const response=await fetch('/api/customer-account?'+query,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify({...body,action})}:{}),signal:AbortSignal.timeout(15000)});
 let result;try{result=await response.json();}catch{throw error('Serviço temporariamente indisponível.',503);}
 if(!response.ok)throw error(result.error||'Não foi possível concluir.',response.status);
 return result;
}
