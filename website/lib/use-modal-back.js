'use client';

import * as React from 'react';

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
 * 1. MODAL KE ANDAR SE KISI LINK PAR JAANA. Tab tak history me hamari entry ke UPAR naya
 *    page aa chuka hota hai, to cleanup `history.back()` NAHI chalata (warna wo abhi-abhi
 *    hui navigation ko hi palat deta — isse bura kuch nahi). Nateeja: ek entry neeche padi
 *    reh jaati hai, yaani naye page se nikalne me ek Back zyada lag sakta hai. Ye aaj ki
 *    haalat se phir bhi behtar hai, jahan HAR Back page chhod deta tha.
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
export function useModalBack(open, close) {
  const id = React.useId();
  // Taaza `close` har render par chahiye, par uski wajah se effect dobara nahi chalna
  // chahiye — warna har render par ek nayi history entry jud jaati.
  const closeRef = React.useRef(close);
  closeRef.current = close;

  React.useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;

    window.history.pushState({ __modal: id }, '');
    const onPop = () => closeRef.current?.();
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      // Modal kisi aur tarah se band hua (Close, Escape, bahar tap) — to hamari entry abhi
      // bhi history me sabse upar hai. Use hata do, warna agli baar Back dabane par kuch
      // nahi hoga aur user ko lagega button hi kharab hai.
      if (window.history.state?.__modal === id) window.history.back();
    };
  }, [open, id]);
}
