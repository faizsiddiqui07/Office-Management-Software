/**
 * Buddy ka dimaag — sawaal lo, tools chalao, jawab do.
 * (Plan: audits/15-ai-buddy-plan.md)
 *
 * Poora chakkar ek hi HTTP request ke andar khatam hota hai, isliye har cheez par
 * dhakkan laga hai: kitne round chalenge, kitne token banenge, kitni der lagegi. API
 * Gateway 29 second par request kaat deta hai — usse pehle humein khud rukna hai.
 */
import { AuditLog, audit } from '../../models/AuditLog.js';
import { AssistantMessage } from '../../models/AssistantMessage.js';
import { sealBytes, openBytes } from '../../lib/secretBox.js';
import { claudeClient, CLAUDE_DEFAULTS, describeClaudeError } from '../../lib/claude.js';
import { systemFor } from './prompt.js';
import { toolsFor, toolDefs, runTool } from './tools.js';
import { actionTools, isActionTool, proposeAction, confirmAction } from './actions.js';

// Baaki services jaisa hi — is codebase me httpError har service apna rakhti hai.
function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** Ek sawaal me zyada se zyada itne chakkar. 3 ke baad jawab majbooran banana padta hai. */
const MAX_ROUNDS = 3;
/** Jawab chhota rehna chahiye — aur drift ho jaye to nibandh na likh sake. */
const MAX_TOKENS = 500;
/** Ek bande ke ek ghante me itne sawaal. Paise aur galti dono par dhakkan. */
const PER_HOUR = 30;
/** Itne akshar se bada sawaal lena hi nahi — wo sawaal nahi, kuch aur hai. */
const MAX_QUESTION = 500;
/**
 * Pichhli kitni baatein AI ko yaad rahengi.
 *
 * Saari 90 din ki history bhejna do wajah se galat hota: har sawaal ka kharcha badhta
 * jaata (purani baatein bar-bar padhni padtin), aur purani baat naye sawaal ka matlab
 * bigaad deti. Chhe se "uska matlab?" jaise sawaal chal jaate hain, aur usse zyada ki
 * zaroorat shayad hi padti ho.
 */
const MEMORY_TURNS = 6;
/** Ek baar me kitni purani baatein (scroll-upar wala page). */
export const HISTORY_PAGE = 20;
/** Devanagari ki range. Sirf ye dekhne ko ki jawab kis lipi me aaya. */
const DEVANAGARI = /[\u0900-\u097F]/;

/**
 * Pichhle ek ghante me isne kitne sawaal poochhe.
 *
 * Ginti Activity log se hi hoti hai — wahi ek jagah jahan har sawaal waise bhi likha
 * jaata hai. Alag counter rakhne ka matlab hota do jagah ek hi sach, aur Lambda ke
 * alag-alag container me memory wala counter chalta bhi nahi.
 *
 * Imaandari se: ek hi pal me aayi do request dono gin sakti hain (log baad me likha
 * jaata hai). 15 logon ke liye ye kaafi hai; pakka chahiye hoga to atomic counter banega.
 */
async function askedLastHour(userId) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return AuditLog.countDocuments({ actor: userId, action: 'assistant.ask', createdAt: { $gte: since } });
}

/** Ciphertext → text. `null` matlab "rakha to hai par khulta nahi" — chhupana galat. */
const readBody = (buf) => {
  if (!buf || !buf.length) return '';
  const out = openBytes(buf);
  return out === null ? '⚠️ This message could not be opened' : out;
};

/**
 * Pichhli baatein — AI ko dene ke liye, nayi se purani uthaa kar seedhi kar di gayi.
 */
async function recentTurns(userId) {
  // `_id` ka tiebreaker ZAROORI hai: sawaal aur jawab ek hi insert me jaate hain, to
  // `createdAt` ek jaisa ho sakta hai aur akele usse kram tay nahi hota. ObjectId
  // insert ke kram me banti hai, isliye wo sach batati hai.
  const rows = await AssistantMessage.find({ user: userId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(MEMORY_TURNS)
    .select('role body');

  const turns = rows
    .reverse()
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: readBody(m.body) }))
    .filter((m) => m.content);

  // API ka niyam: pehla message `user` ka hona chahiye aur role badal-badal kar aane
  // chahiye. Purani kharab-kram wali rows (jab tiebreaker nahi tha) aise list bana
  // sakti hain jo ye niyam tode. Bhejne se pehle saaf kar lo — warna ya to request
  // hi 400 khaati hai, ya model ko jawab apne AGLE sawaal se juda dikhta hai aur wo
  // har baar purana jawab dohraane lagta hai (yahi wo bug tha).
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const clean = [];
  for (const t of turns) {
    if (clean.length && clean[clean.length - 1].role === t.role) clean[clean.length - 1] = t;
    else clean.push(t);
  }
  // Aakhir me `assistant` hona chahiye — uske baad hi naya sawaal judega.
  if (clean.length && clean[clean.length - 1].role === 'user') clean.pop();
  return clean;
}

/**
 * Purani baatein — screen ke liye. `before` se pehle wali, nayi se purani.
 *
 * Ek saath sab nahi bhejte: 90 din ki baatein ek page par laadna dheema bhi hai aur
 * bekaar bhi. Panel khulte hi aakhri ${HISTORY_PAGE}, aur upar scroll karne par utni aur.
 */
export async function history(user, { before, limit = HISTORY_PAGE } = {}) {
  const n = Math.min(Math.max(Number(limit) || HISTORY_PAGE, 1), 50);
  const filter = { user: user._id };
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) filter.createdAt = { $lt: d };
  }
  // Wahi `_id` tiebreaker — warna ek hi insert ke do messages ulte kram me aa jaate
  // hain aur screen par jawab sawaal se PEHLE dikhta hai.
  const rows = await AssistantMessage.find(filter).sort({ createdAt: -1, _id: -1 }).limit(n + 1).select('role body createdAt');
  const page = rows.slice(0, n);
  return {
    // Client ko seedha kram chahiye — purani upar, nayi neeche.
    turns: page.reverse().map((m) => ({ role: m.role, text: readBody(m.body), at: m.createdAt })),
    // `hasMore` ek extra row maang kar tay hota hai, ginti karke nahi — 90 din ki
    // countDocuments har baar chalana bekaar hai.
    hasMore: rows.length > n,
    oldest: page.length ? page[0].createdAt : null,
  };
}

/**
 * Ek sawaal ka jawab.
 *
 * @param {object} user  token se nikla hua user — AI ke kehne se NAHI
 * @param {string} question
 */
export async function ask(user, question) {
  const q = String(question || '').trim();
  if (!q) throw httpError(400, 'EMPTY', 'Ask me something first.');
  if (q.length > MAX_QUESTION) {
    throw httpError(400, 'TOO_LONG', `That is a bit long — keep it under ${MAX_QUESTION} characters.`);
  }

  const client = claudeClient();
  if (!client) throw httpError(503, 'AI_OFF', 'The assistant is switched off right now.');

  if ((await askedLastHour(user._id)) >= PER_HOUR) {
    throw httpError(429, 'TOO_MANY', 'That is all the questions for this hour — please come back in a little while.');
  }

  // Isi bande ke tools. Jo is list me nahi hai, Claude use bula hi nahi sakta.
  const readTools = toolsFor(user);
  // "propose_*" wale tools KUCH KARTE NAHI — sirf tajweez banate hain. Asli kaam
  // /assistant/confirm se hota hai, yaani user ke Confirm dabane par.
  const tools = [...toolDefs(readTools), ...actionTools(user)];
  const system = systemFor(user);
  // Pichhli chand baatein saath me — taaki "uska matlab?" jaisa sawaal chal sake.
  const messages = [...(await recentTurns(user._id)), { role: 'user', content: q }];

  const used = [];
  let pending = null;
  const usage = { input: 0, output: 0, cacheRead: 0 };
  const startedAt = Date.now();
  let answer = '';
  let rounds = 0;

  try {
    for (let i = 0; i < MAX_ROUNDS; i += 1) {
      rounds = i + 1;
      // eslint-disable-next-line no-await-in-loop
      const res = await client.messages.create({
        ...CLAUDE_DEFAULTS,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages,
      });

      usage.input += res.usage?.input_tokens || 0;
      usage.output += res.usage?.output_tokens || 0;
      usage.cacheRead += res.usage?.cache_read_input_tokens || 0;

      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      const calls = res.content.filter((b) => b.type === 'tool_use');

      if (!calls.length) {
        answer = text;
        break;
      }

      // Saare tool ek saath chalao, aur SAB ke jawab EK hi user message me wapas bhejo —
      // alag-alag message me bhejne se model agli baar parallel calls karna chhod deta hai.
      messages.push({ role: 'assistant', content: res.content });
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(
        calls.map(async (c) => {
          used.push(c.name);
          const out = isActionTool(c.name)
            ? await proposeAction(user, c.name, c.input)
            : await runTool(user, c.name, c.input);
          // Tajweez bani to use jawab ke saath bahar bhejna hai, taaki UI Confirm ka
          // button dikha sake. Aakhri wali hi rakhte hain — ek sawaal, ek kaam.
          if (out?.needsConfirm) pending = { id: out.proposalId, summary: out.summary, kind: c.name.replace(/^propose_/, '') };
          return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) };
        }),
      );
      messages.push({ role: 'user', content: results });

      // Aakhri chakkar me bhi tool maanga — ab aur nahi. Jo text mila wahi jawab hai.
      if (i === MAX_ROUNDS - 1) answer = text || 'That is as far as I got — try asking it a different way.';
    }
  } catch (err) {
    await audit({
      actor: user._id,
      action: 'assistant.ask',
      meta: { failed: true, error: describeClaudeError(err), ms: Date.now() - startedAt },
    });
    throw httpError(502, 'AI_FAILED', describeClaudeError(err));
  }

  // ── Lipi ki jaanch ────────────────────────────────────────────────────────────
  // Sawaal Roman me tha par jawab Devanagari me aa gaya — aisa kabhi-kabhi hota hai.
  // Prompt me saaf likha hai, phir bhi model das me se ek baar phisal jaata hai.
  //
  // Jahan jaanch itni aasan ho, wahan sirf prompt par bharosa karna galat hai: dekh lo,
  // aur ek baar sudharne ko kaho. Ye sirf PHISALNE par chalta hai, har sawaal par nahi,
  // isliye kharcha na ke barabar badhta hai. Ek hi mauka — doosri baar bhi Devanagari
  // aaye to jo mila wahi rakh lo, warna ye loop ban jayega.
  let scriptFixed = false;
  if (answer && DEVANAGARI.test(answer) && !DEVANAGARI.test(q)) {
    try {
      const again = await client.messages.create({
        ...CLAUDE_DEFAULTS,
        max_tokens: MAX_TOKENS,
        system,
        messages: [
          { role: 'user', content: q },
          { role: 'assistant', content: answer },
          { role: 'user', content: 'Write that again in Roman letters only — same words, same meaning, same length. No Devanagari.' },
        ],
      });
      usage.input += again.usage?.input_tokens || 0;
      usage.output += again.usage?.output_tokens || 0;
      usage.cacheRead += again.usage?.cache_read_input_tokens || 0;
      const redone = again.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      if (redone && !DEVANAGARI.test(redone)) { answer = redone; scriptFixed = true; }
    } catch (err) {
      // Sudhaar na ho paye to jo jawab hai wahi do — Devanagari me sahi jawab,
      // "kuch gadbad ho gayi" se behtar hai.
      console.error('buddy script retry failed:', describeClaudeError(err));
    }
  }

  const ms = Date.now() - startedAt;

  // Baatcheet apni jagah, encrypted (dekho models/AssistantMessage.js). Ye wahi
  // jagah hai jahan se panel history padhta hai aur jahan se AI ko yaad aati hai.
  try {
    // Waqt JAAN-BUJH KAR alag diya ja raha hai. Ek hi insert me dono ka `createdAt`
    // ek hi millisecond ka ban jata tha, aur phir kram sirf `_id` ke bharose rehta.
    // Dono taale lage rehne chahiye — paging `createdAt` par chalti hai.
    const at = new Date();
    await AssistantMessage.insertMany([
      { user: user._id, role: 'user', body: sealBytes(q), createdAt: at },
      { user: user._id, role: 'buddy', body: sealBytes(answer || ''), createdAt: new Date(at.getTime() + 1) },
    ]);
  } catch (err) {
    // Baat na save ho payi to jawab phir bhi dena hai — user ko uska kaam mila,
    // history ka chhutna usse rokne ki wajah nahi.
    console.error('buddy history save failed:', err?.message);
  }

  // Har sawaal log hota hai — kisne, kab, kaunse tool chale, kitna laga.
  // `noTool` wo sawaal hain jinme ek bhi tool nahi chala: aam taur par salaam-dua, ya
  // wo baatein jo app se bahar ki thi. Hafte bhar baad isi se pata chalega ki log kitna
  // bhatak rahe hain, aur prompt kasni hai ya nahi.
  await audit({
    actor: user._id,
    action: 'assistant.ask',
    // SAWAAL KA MATN YAHAN JAAN-BUJH KAR NAHI HAI (owner ka faisla, 24 Oct 2026).
    // Activity page leadership ko dikhta hai aur wahan poora meta khulta hai. Baatcheet
    // ek taraf encrypted rakhein aur doosri taraf wahi matn khule log me chhod dein —
    // wo taala lagane ka natak hota. Kharche aur durupyog ke liye ginti aur tool kaafi
    // hain; KYA poocha, wo jaanne ki zaroorat nahi.
    meta: {
      tools: used, noTool: used.length === 0, rounds, ms, usage,
      ...(scriptFixed ? { scriptFixed: true } : {}),
      ...(pending ? { proposed: pending.kind, proposalId: pending.id } : {}),
    },
  });

  return { answer, tools: used, rounds, ms, usage, scriptFixed, pending };
}

/**
 * User ne Confirm dabaya — ab kaam hoga.
 *
 * Yahan AI ka koi dakhal nahi: wo tajweez de kar apna kaam khatam kar chuka. Kya hoga,
 * ye server ki apni likhi hui tajweez se uthta hai, aur permission dobara jaanchi jaati
 * hai. Dono — tajweez aur uska anjaam — Activity log me jaate hain, taaki baad me pata
 * chale ki bande ne haan KIS baat par kahi thi.
 */
export async function confirm(user, proposalId) {
  if (!proposalId) throw httpError(400, 'EMPTY', 'Nothing to confirm.');
  const done = await confirmAction(user, proposalId);
  await audit({
    actor: user._id,
    action: 'assistant.confirm',
    entityType: 'AssistantAction',
    entityId: String(proposalId),
    meta: { kind: done.kind, summary: done.summary, result: done.result },
  });
  return done;
}
