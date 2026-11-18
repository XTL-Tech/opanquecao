// XTL Food LAB: signed gateway. This function has NO PUBLIC DATA ACCESS.
// Auth: Ed25519 signed body + timestamp, verified before any database query.
// Environment required: FOOD_GATEWAY_PUBLIC_KEY_B64 (SPKI DER, base64).
// Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY inside Edge only.
// Never share the service-role key with Vercel. Do not expose this function to browsers.
const RESTAURANT = "opanquecao";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const REF8 = /^[0-9a-f]{8}$/;
const OPS = new Set(["ledger.lookup","ledger.claim","ledger.finish","review.get",
  "review.create","review.set_telegram","review.decide","store.get"]);
function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {status, headers:{
    "content-type":"application/json; charset=utf-8", "cache-control":"no-store",
    "x-content-type-options":"nosniff"}});
}
function okId(input: Record<string,unknown>): boolean {
  return typeof input.requestId==="string" && UUID.test(input.requestId);
}
function b64urlToBytes(value: string): Uint8Array {
  const raw=atob(value.replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function verified(req: Request, raw: string, publicKeyB64: string): Promise<boolean> {
  try {
    const timestamp=req.headers.get("x-xtl-food-time");
    const nonce=req.headers.get("x-xtl-food-nonce");
    const sig=req.headers.get("x-xtl-food-signature");
    if(!timestamp||!/^[0-9]{13}$/.test(timestamp)||!nonce||!/^[A-Za-z0-9_-]{22}$/.test(nonce)||
       !sig||!/^[A-Za-z0-9_-]{86}$/.test(sig))return false;
    if(Math.abs(Date.now()-Number(timestamp))>45000)return false;
    const pub=b64urlToBytes(publicKeyB64);
    const key=await crypto.subtle.importKey("spki",pub,{name:"Ed25519"},false,["verify"]);
    const digest=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))));
    const message=timestamp+"\nPOST\n/xtl-food-gateway\n"+nonce+"\n"+digest;
    return await crypto.subtle.verify("Ed25519",key,b64urlToBytes(sig),new TextEncoder().encode(message));
  } catch {return false;}
}
// Atomic one-time nonce reservation prevents replay inside the 45s signature window.
// Any database failure denies the request before it reaches operational tables.
async function reserveNonce(req: Request, projectUrl: string, secret: string): Promise<boolean> {
  const nonce=req.headers.get("x-xtl-food-nonce");
  if(!nonce||!/^[A-Za-z0-9_-]{22}$/.test(nonce))return false;
  const nonceSha=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(nonce))));
  const target=projectUrl.replace(/\/$/,"")+
    "/rest/v1/xtl_food_gateway_nonces?on_conflict=nonce_sha256";
  const resp=await fetch(target,{
    method:"POST",
    headers:{apikey:secret,Authorization:"Bearer "+secret,
      "Content-Type":"application/json",Prefer:"resolution=ignore-duplicates,return=representation"},
    body:JSON.stringify({nonce_sha256:nonceSha,restaurant_id:RESTAURANT,
      expires_at:new Date(Date.now()+120000).toISOString()}),
    signal:AbortSignal.timeout(5000)
  });
  if(!resp.ok)throw new Error("nonce_db_unavailable");
  const rows:unknown=await resp.json().catch(()=>null);
  if(!Array.isArray(rows))throw new Error("nonce_db_invalid_response");
  return rows.length===1;
}
async function rowsFor(action:string,input:Record<string,unknown>,url:string,key:string):Promise<unknown[]> {
  const root=url.replace(/\/$/,"")+"/rest/v1/";
  const headers:Record<string,string>={apikey:key,Authorization:"Bearer "+key,
    Accept:"application/json","Content-Type":"application/json"};
  let table:string, query:string, method="GET", body:unknown=undefined;
  let prefer="";
  const id=typeof input.requestId==="string"?input.requestId:"";
  const filter="restaurant_id=eq."+RESTAURANT+"&request_id=eq."+encodeURIComponent(id);
  switch(action){
    case "store.get":
      table="restaurant_operations";
      query="restaurant_id=eq."+RESTAURANT+"&select=restaurant_id,time_zone,accepting_orders,enforce_opening_hours,weekly_schedule,holiday_exceptions,manual_state,manual_override_until&limit=1";
      break;
    case "ledger.lookup":
      if(!okId(input))throw new TypeError("invalid request");
      table="restaurant_order_intents";query=filter+"&select=request_id,payload_sha256,status,order_ref&limit=1";
      break;
    case "ledger.claim":
      if(!okId(input)||typeof input.digest!=="string"||!HEX64.test(input.digest)||
        typeof input.orderRef!=="string"||!REF8.test(input.orderRef))throw new TypeError("invalid claim");
      table="restaurant_order_intents";query="on_conflict=restaurant_id,request_id";method="POST";
      prefer="resolution=ignore-duplicates,return=representation";
      body={restaurant_id:RESTAURANT,request_id:id,payload_sha256:input.digest,
        order_ref:input.orderRef,status:"processing"};
      break;
    case "ledger.finish":
      if(!okId(input)||!["delivered","needs_review"].includes(String(input.status))||
        (input.messageId!==null && input.messageId!==undefined &&
          (!Number.isSafeInteger(input.messageId)||Number(input.messageId)<1)))throw new TypeError("invalid finish");
      table="restaurant_order_intents";query=filter+"&status=eq.processing";method="PATCH";
      prefer="return=representation";
      body={status:input.status,telegram_message_id:input.messageId??null,
        updated_at:new Date().toISOString()};
      break;
    case "review.get":
      if(!okId(input))throw new TypeError("invalid review id");
      table="restaurant_preorder_reviews";query=filter+"&select=*&limit=1";
      break;
    case "review.create":{
      if(!okId(input)||typeof input.orderRef!=="string"||!REF8.test(input.orderRef)||
        typeof input.trackingSha256!=="string"||!HEX64.test(input.trackingSha256)||
        typeof input.name!=="string"||input.name.trim().length<1||input.name.length>80||
        typeof input.phone!=="string"||!/^[0-9]{10,11}$/.test(input.phone)||
        !Array.isArray(input.items)||input.items.length<1||input.items.length>50||
        !input.fulfillment||typeof input.fulfillment!=="object"||Array.isArray(input.fulfillment)||
        !input.payment||typeof input.payment!=="object"||Array.isArray(input.payment)||
        !Number.isSafeInteger(input.subtotal)||Number(input.subtotal)<0||Number(input.subtotal)>10000000||
        (input.fee!==null&&input.fee!==undefined&&(!Number.isSafeInteger(input.fee)||Number(input.fee)<0||Number(input.fee)>10000))||
        JSON.stringify(input.items).length>18000)throw new TypeError("invalid review");
      table="restaurant_preorder_reviews";query="on_conflict=restaurant_id,request_id";method="POST";
      prefer="resolution=ignore-duplicates,return=representation";
      body={restaurant_id:RESTAURANT,request_id:id,order_ref:input.orderRef,
        tracking_sha256:input.trackingSha256,customer_name:input.name,customer_phone:input.phone,
        items_snapshot:input.items,fulfillment_snapshot:input.fulfillment,
        payment_snapshot:input.payment,subtotal_cents:input.subtotal,
        delivery_fee_cents:input.fee??null,status:"pending_review"};
      break;
    }
    case "review.set_telegram":
      if(!okId(input)||!Number.isSafeInteger(input.messageId)||Number(input.messageId)<1)throw new TypeError("invalid message");
      table="restaurant_preorder_reviews";query=filter+"&status=eq.pending_review&telegram_message_id=is.null";
      method="PATCH";prefer="return=representation";
      body={telegram_message_id:input.messageId,updated_at:new Date().toISOString()};
      break;
    case "review.decide":{
      if(!okId(input)||!["approved","rejected","delivery_uncertain"].includes(String(input.status)))throw new TypeError("invalid decision");
      const terminal=input.status!=="delivery_uncertain";
      if(terminal&&(!Number.isSafeInteger(input.actorId)||Number(input.actorId)<1||
          !Number.isSafeInteger(input.messageId)||Number(input.messageId)<1))throw new TypeError("invalid actor");
      if(input.status==="rejected"&&(
        typeof input.reason!=="string"||input.reason.trim().length<5||input.reason.length>220))
        throw new TypeError("invalid reason");
      table="restaurant_preorder_reviews";
      query=filter+"&status=eq.pending_review"+(terminal?"&telegram_message_id=eq."+input.messageId:"");
      method="PATCH";prefer="return=representation";
      body={status:input.status,rejection_reason:input.status==="rejected"?input.reason:null,
        reviewed_by:terminal?input.actorId:null,reviewed_at:terminal?new Date().toISOString():null,
        updated_at:new Date().toISOString()};
      break;
    }
    default: throw new TypeError("unknown operation");
  }
  const target=root+table+"?"+query;
  if(prefer)headers.Prefer=prefer;
  let upstream:Response;
  try {
    upstream=await fetch(target,{method,headers,body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(5000)});
  }catch{throw new Error("db_connection_failed");}
  if(!upstream.ok)throw new Error("db_rejected_request");
  const data:unknown=await upstream.json().catch(()=>null);
  if(!Array.isArray(data))throw new Error("db_invalid_response");
  return data;
}
Deno.serve(async(req:Request):Promise<Response>=>{
  if(req.method!=="POST")return response(405,{error:"method_not_allowed"});
  const configuredKey=Deno.env.get("FOOD_GATEWAY_PUBLIC_KEY_B64");
  if(!configuredKey)return response(503,{error:"gateway_not_configured"});
  const size=Number(req.headers.get("content-length")||0);
  if(size>50000)return response(413,{error:"request_too_large"});
  let raw:string;
  try{raw=await req.text();}catch{return response(400,{error:"invalid_request"});}
  if(raw.length>50000)return response(413,{error:"request_too_large"});
  if(!(await verified(req,raw,configuredKey)))return response(401,{error:"unauthorized"});
  let data:{action?:unknown,input?:unknown};
  try{data=JSON.parse(raw);}catch{return response(400,{error:"invalid_json"});}
  if(!data||typeof data!=="object"||typeof data.action!=="string"||!OPS.has(data.action)||
     !data.input||typeof data.input!=="object"||Array.isArray(data.input))
     return response(400,{error:"invalid_action"});
  const projectUrl=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!projectUrl||!serviceKey)return response(503,{error:"database_not_configured"});
  try {
    const accepted=await reserveNonce(req,projectUrl,serviceKey);
    if(!accepted)return response(409,{error:"request_already_used"});
    const rows=await rowsFor(data.action,data.input as Record<string,unknown>,projectUrl,serviceKey);
    return response(200,{rows});
  }catch(e){
    if(e instanceof TypeError)return response(400,{error:"invalid_input"});
    console.error(JSON.stringify({event:"xtl_food_gateway",action:data.action,reason:"database_failure"}));
    return response(503,{error:"database_unavailable"});
  }
});
