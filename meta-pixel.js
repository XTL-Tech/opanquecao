/* Meta Pixel do Disk Panquecão: opt-in explícito, sem enviar dados pessoais.
 * 'Lead' representa somente pré-registro confirmado pelo bot, não venda.
 * 'Purchase' fica reservado à confirmação comercial da loja (futura integração).
 */
(function () {
    'use strict';
    const CONSENT_KEY = 'disk-panquecao-analytics-consent-v1';
    const PIXEL_ID = '766179976513223';
    const ALLOWED = new Set(['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Lead', 'Contact']);
    let consent = null;
    let initialized = false;
    let pageTracked = false;

    try { consent = window.localStorage.getItem(CONSENT_KEY); } catch {}

    function track(eventName, parameters = {}) {
        if (!ALLOWED.has(eventName) || consent !== 'accepted' || !initialized ||
            typeof window.fbq !== 'function') return false;
        try {
            window.fbq('track', eventName, parameters);
            return true;
        } catch { return false; }
    }

    function enableAnalytics() {
        if (consent !== 'accepted') return;
        if (initialized) {
            try { window.fbq('consent', 'grant'); } catch {}
            return;
        }
        // O script externo não é baixado antes de consentimento positivo.
        (function (f,b,e,v,n,t,s) {
            if (f.fbq) return;
            n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if (!f._fbq) f._fbq=n;
            n.push=n;n.loaded=true;n.version='2.0';n.queue=[];
            t=b.createElement(e);t.async=true;t.src=v;
            s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);
        })(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
        if (typeof window.fbq !== 'function') return;
        window.fbq('init', PIXEL_ID);
        initialized = true;
        if (!pageTracked) {
            pageTracked = track('PageView');
            // Nas páginas de categoria, a visualização tem contexto.
            const category = document.querySelector('meta[name="xtl-category"]')?.content;
            if (category) track('ViewContent', {content_type:'product_group', content_category:category});
        }
    }

    function createCategoryConsentUI() {
        if (document.getElementById('analyticsNotice')) return;
        const style = document.createElement('style');
        style.textContent = '.xtl-consent-banner{position:fixed;z-index:5000;bottom:12px;left:12px;right:12px;max-width:580px;margin:auto;box-sizing:border-box;padding:16px;background:#fffaf3;border:1px solid #c9a5a4;border-radius:14px;box-shadow:0 10px 30px #381d2050;color:#381d20;font:14px/1.5 system-ui,sans-serif}.xtl-consent-banner[hidden]{display:none!important}.xtl-consent-banner p{margin:0 0 10px}.xtl-consent-actions{display:flex;gap:8px;flex-wrap:wrap}.xtl-consent-actions button{flex:1;min-height:44px;border:1px solid #741c2d;background:#fff;border-radius:8px;color:#741c2d;font-weight:700;cursor:pointer}.xtl-consent-actions button:last-child{color:white;background:#741c2d}.xtl-consent-manage{margin:14px auto;background:none;color:inherit;border:0;text-decoration:underline;cursor:pointer;font:inherit;min-height:44px}';
        document.head.append(style);
        const notice = document.createElement('div');
        notice.id = 'analyticsNotice';
        notice.hidden = true;
        notice.className = 'xtl-consent-banner';
        notice.setAttribute('role','region');
        notice.setAttribute('aria-label','Preferências de privacidade');
        const content = document.createElement('p');
        content.textContent = 'Usamos dados necessários para abrir o cardápio. Com sua autorização, o Pixel da Meta ajuda a medir visitas e pedidos. ';
        const privacy = document.createElement('a');
        privacy.href='/privacidade.html';
        privacy.textContent='Privacidade';
        content.append(privacy);
        const actions = document.createElement('div');
        actions.className='xtl-consent-actions';
        for (const [id,label] of [['analyticsReject','Somente essenciais'],['analyticsAccept','Aceitar análise']]) {
            const button=document.createElement('button');
            button.type='button';button.id=id;button.textContent=label;
            actions.append(button);
        }
        notice.append(content,actions);
        document.body.append(notice);
        const manage=document.createElement('button');
        manage.id='analyticsManage';manage.type='button';
        manage.className='xtl-consent-manage';manage.textContent='Preferências de privacidade';
        (document.querySelector('footer')||document.body).append(manage);
    }

    function init() {
        createCategoryConsentUI();
        const notice=document.getElementById('analyticsNotice');
        if (!notice) return;
        function choose(value) {
            consent=value;
            try { window.localStorage.setItem(CONSENT_KEY,value); } catch {}
            notice.hidden=true;
            if (value==='accepted') enableAnalytics();
            else if (initialized) {
                try { window.fbq('consent','revoke'); } catch {}
            }
        }
        document.getElementById('analyticsAccept')?.addEventListener('click',()=>choose('accepted'));
        document.getElementById('analyticsReject')?.addEventListener('click',()=>choose('rejected'));
        document.getElementById('analyticsManage')?.addEventListener('click',()=>{notice.hidden=false;});
        document.addEventListener('click',event=>{
            if (event.target.closest('a.whatsapp-float')) {
                track('Contact',{content_category:'pedido_whatsapp',content_name:'Botão Flutuante WhatsApp'});
            }
        });
        if (consent==='accepted') enableAnalytics();
        else if(consent!=='rejected') notice.hidden=false;
    }

    // No contexto de pedidos, nunca dispare Purchase por pré-registro.
    window.XTLMeta = Object.freeze({track});
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
    else init();
}());
