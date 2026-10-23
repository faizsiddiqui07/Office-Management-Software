/**
 * Claude ka client — AI Buddy ka ikloata darwaza (plan: audits/15-ai-buddy-plan.md).
 *
 * Yahan sirf CONNECTION hai. Kaun kya poochh sakta hai, wo yahan tay NAHI hota — wo
 * tools ke andar `can()` se tay hota hai. Ye farak jaan-bujh kar hai: agar access ka
 * faisla kabhi prompt me likha gaya, to kisi din koi ghuma kar nikal lega.
 */
import Anthropic from '@anthropic-ai/sdk';

/** Owner ka faisla (23 Oct 2026). Env se badla ja sakta hai — code dobara likhe bina. */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

/**
 * Buddy ke har request ka saanjha roop.
 *
 * `effort: 'low'` — ye chat jaisa kaam hai (tay tools se chhote, seedhe sawaal), koi
 * gehri soch nahi. Sonnet 5.5 par default `high` hai, jo yahan dheema aur mehenga dono
 * padta. Thinking jaan-bujh kar chhoda hua hai: is model par `disabled` 400 deta hai,
 * aur adaptive hi theek hai.
 */
export const CLAUDE_DEFAULTS = {
  model: CLAUDE_MODEL,
  output_config: { effort: 'low' },
};

/** Key lagi hai ya nahi. Bina key ke app chalni CHAHIYE — bas buddy band rahega. */
export const claudeConfigured = () => !!process.env.ANTHROPIC_API_KEY;

let cached = null;

/**
 * Client — ek Lambda container me ek hi baar banta hai.
 *
 * Module load par NAHI banaya jaata: key na hone par wo poore backend ko gira deta, aur
 * ek band feature ki wajah se attendance tak na khulna bilkul galat trade hai.
 *
 * `timeout` 20 sec: API Gateway 29 sec par request kaat deta hai, to usse pehle humein
 * khud haarna hai — warna user ko gateway ka kachcha 504 milta hai, hamara saaf message
 * nahi. `maxRetries: 1` isi budget ke andar rehne ke liye.
 */
export function claudeClient() {
  if (!claudeConfigured()) return null;
  if (!cached) cached = new Anthropic({ timeout: 20_000, maxRetries: 1 });
  return cached;
}

/**
 * Anthropic ki galti ko aise message me badlo jo padhne wale ke kaam aaye.
 * Kachcha "401 Unauthorized" kisi ko nahi batata ki karna kya hai.
 */
export function describeClaudeError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'API key galat hai ya laga hi nahi — Lambda ke ANTHROPIC_API_KEY ko dekho.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'Is key ko is model ki ijaazat nahi hai (workspace/scope dekho).';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Abhi bahut saare sawaal ja rahe hain — thodi der baad.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Request hi galat bani: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Anthropic tak pahunch nahi paaye (network ya timeout).';
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic se ${err.status}: ${err.message}`;
  }
  return err?.message || 'Pata nahi kya hua.';
}

/**
 * Phase 0 ki jaanch: key chal rahi hai, model jawab de raha hai, aur kitna lagta hai.
 *
 * Jaan-bujh kar WAHI settings se jaata hai jo buddy use karega — warna ye sirf "key
 * sahi hai" batata, ye nahi ki hamara asli config chalta hai.
 */
export async function claudePing() {
  const client = claudeClient();
  if (!client) {
    return { ok: false, configured: false, error: 'ANTHROPIC_API_KEY laga hi nahi hai.' };
  }

  const startedAt = Date.now();
  try {
    const res = await client.messages.create({
      ...CLAUDE_DEFAULTS,
      max_tokens: 64,
      system: 'Reply with exactly one short sentence. No preamble.',
      messages: [{ role: 'user', content: 'Say that the ManagiBot assistant connection is working.' }],
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return {
      ok: true,
      configured: true,
      model: res.model,
      latencyMs: Date.now() - startedAt,
      reply: text,
      stopReason: res.stop_reason,
      usage: {
        input: res.usage?.input_tokens ?? null,
        output: res.usage?.output_tokens ?? null,
        cacheRead: res.usage?.cache_read_input_tokens ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      latencyMs: Date.now() - startedAt,
      error: describeClaudeError(err),
      status: err?.status ?? null,
    };
  }
}
