/**
 * Phase 0 ki jaanch — key chal rahi hai aur model jawab de raha hai (plan: audits/15-ai-buddy-plan.md).
 *
 * Ispar PAISA lagta hai — har run par ek chhoti asli request jaati hai (ek paisa se bhi
 * kam, par mufat nahi). DB ki zaroorat nahi.
 *
 *   node scripts/test-claude-ping.js
 */
import 'dotenv/config';
import { claudePing, CLAUDE_MODEL, claudeConfigured } from '../src/lib/claude.js';

// Sonnet 5.5 ke daam ($ per 10 lakh token) — sirf andaza dikhane ke liye.
const PRICE = { input: 2, output: 10 };

console.log(`\nModel: ${CLAUDE_MODEL}`);

if (!claudeConfigured()) {
  console.log('\n❌ ANTHROPIC_API_KEY mila hi nahi.');
  console.log('   Local ke liye backend/.env me daalo, live ke liye Lambda ke env var me.\n');
  process.exit(1);
}
// Key kabhi chhapni nahi hai — sirf itna ki wo hai aur dikhti kaisi hai.
const key = process.env.ANTHROPIC_API_KEY;
console.log(`Key:   mil gayi (${key.length} akshar, shuruaat "${key.slice(0, 7)}…")`);

const r = await claudePing();

if (!r.ok) {
  console.log(`\n❌ Nahi chala${r.status ? ` (HTTP ${r.status})` : ''}: ${r.error}\n`);
  process.exit(1);
}

const cost = ((r.usage.input || 0) * PRICE.input + (r.usage.output || 0) * PRICE.output) / 1e6;

console.log(`\n✅ Chal raha hai`);
console.log(`   Jawab:   "${r.reply}"`);
console.log(`   Model:   ${r.model}`);
console.log(`   Waqt:    ${r.latencyMs} ms`);
console.log(`   Token:   ${r.usage.input} in / ${r.usage.output} out`);
console.log(`   Kharcha: $${cost.toFixed(6)}  (is ek call ka)\n`);
