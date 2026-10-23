/**
 * Buddy ka dimaag — sawaal lo, tools chalao, jawab do.
 * (Plan: audits/15-ai-buddy-plan.md)
 *
 * Poora chakkar ek hi HTTP request ke andar khatam hota hai, isliye har cheez par
 * dhakkan laga hai: kitne round chalenge, kitne token banenge, kitni der lagegi. API
 * Gateway 29 second par request kaat deta hai — usse pehle humein khud rukna hai.
 */
import { AuditLog, audit } from '../../models/AuditLog.js';
import { claudeClient, CLAUDE_DEFAULTS, describeClaudeError } from '../../lib/claude.js';
import { systemFor } from './prompt.js';
import { toolsFor, toolDefs, runTool } from './tools.js';

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
  const tools = toolsFor(user);
  const system = systemFor(user);
  const messages = [{ role: 'user', content: q }];

  const used = [];
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
        tools: toolDefs(tools),
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
          const out = await runTool(user, c.name, c.input);
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
      meta: { q: q.slice(0, 200), failed: true, error: describeClaudeError(err), ms: Date.now() - startedAt },
    });
    throw httpError(502, 'AI_FAILED', describeClaudeError(err));
  }

  const ms = Date.now() - startedAt;

  // Har sawaal log hota hai — kisne, kya, kaunse tool chale, kitna laga.
  // `noTool` wo sawaal hain jinme ek bhi tool nahi chala: aam taur par salaam-dua, ya
  // wo baatein jo app se bahar ki thi. Hafte bhar baad isi se pata chalega ki log kitna
  // bhatak rahe hain, aur prompt kasni hai ya nahi.
  await audit({
    actor: user._id,
    action: 'assistant.ask',
    meta: { q: q.slice(0, 200), tools: used, noTool: used.length === 0, rounds, ms, usage },
  });

  return { answer, tools: used, rounds, ms, usage };
}
