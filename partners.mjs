import { partners } from './partners-config.mjs';
export function approvedPartners(entries) {
    if (!Array.isArray(entries)) return [];
    const result = [];
    for (const entry of entries) {
        if (result.length >= 3) break;
        if (!entry || entry.active !== true || typeof entry.name !== 'string' || typeof entry.description !== 'string' || typeof entry.url !== 'string') continue;
        const name = entry.name.trim(), description = entry.description.trim();
        if (!name || name.length > 60 || !description || description.length > 100 || entry.url.length > 500) continue;
        let url = null;
        if (entry.url) {try { url = new URL(entry.url); } catch { continue; }
        if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) continue;}
        else if (entry.permanent !== true && entry.allowNoLink !== true) continue;
        const logo = typeof entry.logo === 'string' && /^\/img\/parceiros\/[a-z0-9_-]+\.(?:webp|png|jpg)$/i.test(entry.logo) ? entry.logo : null;
        result.push({ name, description, url: url?.href || '', logo });
    }
    return result;
}
export function renderPartners(root, entries = partners) {
    if (!root) return;
    const list = root.querySelector('[data-partners-list]');
    if (!list) return;
    const doc = root.ownerDocument;
    list.replaceChildren();
    root.hidden = true;
    for (const p of approvedPartners(entries)) {
        const link = doc.createElement(p.url?'a':'div');
        link.className = 'partner-card';
        if(p.url){link.href = p.url;link.target = '_blank';link.rel = 'sponsored noopener noreferrer';}
        if (p.logo) {
            const img = doc.createElement('img');
            img.src = p.logo;
            img.alt = '';
            img.width = 48; img.height = 48;
            img.loading = 'lazy'; img.decoding = 'async';
            img.addEventListener('error', () => img.remove(), { once: true });
            link.append(img);
        }
        const copy = doc.createElement('span');
        const title = doc.createElement('strong'); title.textContent = p.name;
        const desc = doc.createElement('small'); desc.textContent = p.description;
        copy.append(title, desc); link.append(copy);
        list.append(link);
    }
    root.hidden = list.childElementCount === 0;
}
// The checkout explicitly renders this slot only after a successful non-test pre-registration.

export async function loadCheckoutPartners(){
 try{const r=await fetch('/api/backoffice?action=ad_playlist',{credentials:'omit',signal:AbortSignal.timeout(5000)});if(!r.ok)return partners;const d=await r.json();if(!Array.isArray(d.ads)||Date.now()-Date.parse(d.generatedAt)>180000)return partners;return [...partners,...d.ads.filter(x=>[2,3].includes(x.slot)&&x.checkout===true&&Date.parse(x.expiresAt)>Date.now()).slice(0,2).map(x=>({name:x.name,description:x.description||x.headline,url:x.url||'',logo:x.media,active:true,allowNoLink:true}))];}catch{return partners;}
}
