// P926 — prints the Retell agent prompt (built from the VA script questions and rules.js) as JSON, for ai-caller's
// retell_setup action: node scripts/p926-retell-prompt.mjs
import { AI_QUESTIONS } from '../src/lib/aiCaller.js'
import { retellPrompt } from '../supabase/functions/ai-caller/retellSpec.js'
process.stdout.write(JSON.stringify({ prompt: retellPrompt(AI_QUESTIONS) }))
