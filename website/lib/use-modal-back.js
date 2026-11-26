'use client';

import * as React from 'react';

/**
 * Hamari APNI `history.back()` kitni baar chali hai, jiska popstate abhi aana baaki hai.
 *
 * Ye ginti kyun chahiye — ek asli bug jo 26 Nov 2026 ko live jaane ke baad pakda gaya:
 * modal band hone par cleanup apni entry hatane ke liye `history.back()` chalata hai. Wo
 * back ASYNC hai, aur uska popstate tab aata hai jab tak koi DOOSRA modal apna listener
 * laga chuka hota hai. Wo listener use user ka Back samajh kar apne modal ko band kar
 * deta hai.
 *
 * Sabse saaf roop Users page par dikha: "Manage user" se Edit kholo — wo dialog KHULA HUA
 * HI mount hota hai (`open={!!editing}`), to React dev-mode ka double-effect push → back →
 * push kar deta tha, aur beech ka back naye listener se takra kar dialog ko usi pal band
 * kar deta tha. Bahar se lagta tha ki button hi kaam nahi kar raha.
 *
 * Isliye jo back HUMNE khud chalaya hai use gin kar chhod diya jaata hai. Ye dev-mode ki
 * baat nahi hai — do modal tezi se khulne-band hone par asli build me bhi yahi hota.
 */
let selfBacks = 0;

/**
 * PHONE KA BACK BUTTON PEHLE MODAL BAND KARE, PAGE NAHI.
 *
 * KYA DIKKAT THI (owner, 26 Nov 2026): phone par koi bhi modal khol kar Back dabao — modal
 * to band ho jaata tha, par SAATH HI page bhi peechhe chala jaata tha. "Add task" khol kar
 * Back dabaya to To-Do se hi bahar. Poore app ke har modal ke saath yahi tha, kyunki modal
 * khulna browser ke liye koi ghatna hi nahi thi — history me kuch jud-ta hi nahi tha, to
 * Back ka matlab seedha "pichhla page" rehta tha.
 *
 * ILAAJ: modal khulte hi history me ek khaali entry daal do. Ab Back dabane par wahi entry
 * hatti hai — page wahin ka wahin rehta hai, bas modal band hota hai. Doosra Back page ko
 * peechhe le jaata hai, jo hona hi chahiye.
 *
 * Ye tareeka is app me naya nahi hai — Buddy ka panel isi par chal raha hai
 * (components/buddy/buddy.jsx) aur wahan se hi ye logic liya gaya hai. Buddy ke paas
 * abhi apni copy hai; use chhua nahi gaya kyunki wo chal raha hai. Kabhi use bhi isi
 * hook par le aana — do jagah ek hi logic ek din alag ho jaata hai.
 *
 * Yahan hook isliye hai taaki har Dialog aur Sheet ko ye apne aap mile — 49 files me
 * alag-alag likhne ki zaroorat na pade.
 *
 * HAR MODAL KA APNA NISHAAN (`useId`): ek modal ke upar doosra khul sakta hai (jaise kisi
 * dialog ke andar "pakka?" wala confirm). Sabka ek hi nishaan hota to upar wala band hote
 * hi neeche wale ki entry bhi hat jaati. Apne nishaan se har modal sirf APNI entry hatata
 * hai.
 *
 * ── DO HAALAT JAHAN YE POORA JAADU NAHI KARTA, aur dono jaan-boojh kar chhodi gayi hain ──
 *
 * 1. MODAL KE ANDAR SE KISI LINK PAR JAANA. Aise me cleanup apni entry hatata hi NAHI —
 *    kyunki hatane ke liye `history.back()` chalana padta, aur wo abhi-abhi shuru hui
 *    navigation ko hi palat deta. Nateeja: ek entry peechhe padi reh jaati hai, yaani naye
 *    page se nikalne me ek Back zyada lag sakta hai. Ye us haalat se laakh guna behtar hai
 *    jahan page khulta hi na ho.
 *
 *    Pehchana KAISE jaata hai, ye yahan ka sabse ahem sabak hai: "URL badla kya" dekh kar
 *    NAHI. Wo do baar fail hua — router turant URL nahi badalta (dev me ~360ms), to hamara
 *    back navigation se pehle hi chal jaata tha aur "More" menu se page khulta hi nahi tha.
 *    Ab hum IRADA dekhte hain, nateeja nahi: kisi link par tap hua tha ya nahi
 *    (`lastLinkClick`). Click kab hua, ye pakka pata hota hai; router kitni der lega, ye
 *    kabhi pakka nahi hota.
 *
 * 2. DO MODAL ULTE KRAM ME BAND HON (neeche wala pehle). Tab neeche wale ki entry current
 *    nahi hoti, to wo wahin padi reh jaati hai. Aam taur par upar wala hi pehle band hota
 *    hai, to ye shaayad hi dikhe.
 *
 * Dono soorat me sabse bura ye hai ki ek Back "kuch nahi karta" — page galat jagah nahi
 * jaata. Ise theek karne ke liye history ko khud chalana padta, jo Next ke router ke saath
 * lambi musibat hai.
 *
 * @param {boolean} open    Modal abhi khula hai ya nahi.
 * @param {() => void} close Band karne ka tareeka (Back dabne par yahi chalega).
 */
/** Abhi kis-kis modal ki entry history me hai (id se). Dev ke double-effect ke liye. */
const live = new Set();

/**
 * Aakhri baar kisi LINK par kab tap hua — navigation ka seedha nishaan.
 *
 * Pehle maine ye waqt dekh kar tay karne ki koshish ki thi ki navigation hua ya nahi (URL
 * badla ya nahi, thodi der baar-baar dekh kar). Wo fail hua, aur naap ke saath: dev me
 * route pehli baar khulte waqt URL badalne me ~360ms lagte hain, to 240ms ka intezaar kam
 * pad gaya aur hamara `history.back()` navigation ko palat gaya. "More" menu se pehla page
 * khul jaata tha, agle nahi — theek wahi jo owner ne dekha.
 *
 * Waqt ka andaza galat tareeka tha. Click KAB hua, ye hum pakke taur par jaante hain —
 * router kitni der leta hai, wo maayne hi nahi rakhta. Isliye ab IRADA dekhte hain,
 * nateeja nahi.
 */
let lastLinkClick = 0;
if (typeof window !== 'undefined') {
  // Capture phase: link ka apna handler navigation rokh bhi de to bhi hume pata chal jaaye.
  window.addEventListener(
    'click',
    (e) => {
      if (e.target?.closest?.('a[href]')) lastLinkClick = Date.now();
    },
    true,
  );
}

export function useModalBack(open, close) {
  const id = React.useId();
  // Taaza `close` har render par chahiye, par uski wajah se effect dobara nahi chalna
  // chahiye — warna har render par ek nayi history entry jud jaati.
  const closeRef = React.useRef(close);
  closeRef.current = close;

  React.useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;

    live.add(id);
    // PUSH SIRF TAB JAB HAMARI ENTRY PEHLE SE NA HO. React dev-mode har effect ko do baar
    // chalata hai (chalao → saaf karo → phir chalao). Bina is jaanch ke dono baar ek-ek
    // entry jud jaati aur Back do baar dabana padta.
    if (window.history.state?.__modal !== id) window.history.pushState({ __modal: id }, '');

    const onPop = () => {
      // Ye back humne khud chalaya tha (neeche cleanup me) — user ka Back nahi hai.
      if (selfBacks > 0) { selfBacks -= 1; return; }
      closeRef.current?.();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      live.delete(id);

      // Modal kisi aur tarah se band hua (Close, Escape, bahar tap) — to hamari entry abhi
      // bhi history me sabse upar hai. Use hata do, warna agli baar Back dabane par kuch
      // nahi hoga aur user ko lagega button hi kharab hai.
      //
      // PAR SABSE PEHLE: AGAR SHAK HO TO HAATH MAT LAGAO.
      //
      // Modal ke andar se kisi link par tap karna sabse aam aur sabse khatarnaak soorat
      // hai: menu band hota hai (yahi cleanup) AUR Next ka router nayi jagah jaa raha hota
      // hai. Agar hum us pal `history.back()` chala den to wo abhi-abhi shuru hui
      // navigation hi palat jaati hai — bahar se lagta hai ki page khulta hi nahi. Bottom
      // bar ke "More" menu se Rewards khol kar owner ne theek yahi pakda (26 Nov 2026).
      //
      // Isliye faisla WAQT se nahi, IRADE se hota hai: abhi-abhi kisi link par tap hua tha
      // ya nahi (upar `lastLinkClick`). Hua tha, to kuch mat karo — router chahe jitni der
      // le, hum uske raaste me nahi aayenge. Entry ek baar peechhe padi rehti hai (naye page
      // se nikalne me ek Back zyada) — navigation todne se ye bahut behtar hai.
      const hrefOnOpen = window.location.href;
      setTimeout(() => {
        if (live.has(id)) return; // dobara mount ho gaya — entry wahin rehne do
        if (Date.now() - lastLinkClick < 1000) return; // link par tap hua tha — haath mat lagao
        if (window.location.href !== hrefOnOpen) return; // jagah pehle hi badal chuki
        if (window.history.state?.__modal !== id) return; // beech me kuch aur aa gaya
        selfBacks += 1;
        window.history.back();
        // Agar kisi wajah se popstate aaya hi nahi (jaise history me peechhe kuch tha hi
        // nahi), to ginti atak jaati aur user ka AGLA asli Back chup-chaap kha liya jaata.
        setTimeout(() => { if (selfBacks > 0) selfBacks -= 1; }, 300);
      }, 0);
    };
  }, [open, id]);
}
