import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function buildAgentPrompt(answers: Record<string, string>): string {
  return `You are the AI receptionist for ${answers.business_name || answers.owner_name + "'s business"}, a ${answers.niche || 'service'} company in ${answers.city_state || 'the US'}.

Your job is to answer calls professionally, qualify callers, and take messages or route calls appropriately.

Business hours: ${answers.hours || 'Monday–Friday 8am–6pm'}
Services offered: ${answers.services || 'Professional services'}
After hours: ${answers.after_hours === 'Take a message'
  ? 'Take a detailed message and let them know someone will call back next business day'
  : 'Offer to transfer to the owner'}

Always be friendly, professional, and helpful. Never make up information. If unsure, take a message.
Never share pricing without checking with the owner first.
Always get the caller's name and callback number before ending the call.`
}

async function extractAreaCode(phone: string): Promise<string> {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('1') && digits.length === 11) return digits.slice(1, 4)
  if (digits.length === 10) return digits.slice(0, 3)
  return '888' // fallback
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { clientId, answers } = await req.json()

    if (!clientId || !answers) {
      return new Response(
        JSON.stringify({ error: 'clientId and answers are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Step 1: Build Retell agent config ─────────────────────────────────────
    const retellApiKey = Deno.env.get('RETELL_API_KEY')
    let agentId: string | null = null
    let twilioNumber: string | null = null

    if (retellApiKey) {
      const agentConfig = {
        agent_name: `${answers.business_name || 'Business'} AI Receptionist`,
        voice_id: 'eleven_labs_rachel',
        language: 'en-US',
        general_prompt: buildAgentPrompt(answers),
        webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/retell-webhook`,
        begin_message: `Thank you for calling ${answers.business_name || 'us'}! How can I help you today?`,
      }

      try {
        const retellRes = await fetch('https://api.retellai.com/create-agent', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${retellApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(agentConfig),
        })

        if (retellRes.ok) {
          const agent = await retellRes.json()
          agentId = agent.agent_id
        } else {
          console.warn('[build-agent] Retell API error:', await retellRes.text())
        }
      } catch (err) {
        console.warn('[build-agent] Retell call failed:', err)
      }
    } else {
      console.log('[build-agent] RETELL_API_KEY not set — skipping agent creation')
    }

    // ── Step 2: Buy Twilio number in area code ────────────────────────────────
    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const twilioAuth = Deno.env.get('TWILIO_AUTH_TOKEN')

    if (twilioSid && twilioAuth && answers.business_phone) {
      const areaCode = await extractAreaCode(answers.business_phone)
      try {
        const searchRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode}&SmsEnabled=true&VoiceEnabled=true`,
          { headers: { Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}` } }
        )
        if (searchRes.ok) {
          const available = await searchRes.json()
          const firstNumber = available?.available_phone_numbers?.[0]?.phone_number
          if (firstNumber) {
            const buyRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ PhoneNumber: firstNumber }),
              }
            )
            if (buyRes.ok) {
              const purchased = await buyRes.json()
              twilioNumber = purchased.phone_number
            }
          }
        }
      } catch (err) {
        console.warn('[build-agent] Twilio call failed:', err)
      }
    } else {
      console.log('[build-agent] Twilio credentials not set — skipping number purchase')
    }

    // ── Step 3: Update onboarding record ─────────────────────────────────────
    await supabase.from('onboarding').update({
      status: 'completed',
      answers,
      completed_at: new Date().toISOString(),
    }).eq('client_id', clientId)

    // ── Step 4: Update client record ─────────────────────────────────────────
    const clientUpdates: Record<string, string | null> = {
      status: 'active',
      owner_name: answers.owner_name || null,
      owner_email: answers.owner_email || null,
      business_phone: answers.business_phone || null,
      portal_url: `${Deno.env.get('CLIENT_PORTAL_URL') || 'https://client.ohvara.com'}/${clientId}`,
    }
    if (agentId)     clientUpdates.retell_agent_id = agentId
    if (twilioNumber) clientUpdates.twilio_number  = twilioNumber

    await supabase.from('clients').update(clientUpdates).eq('id', clientId)

    // ── Step 5: Notify Brayden ────────────────────────────────────────────────
    const { data: client } = await supabase.from('clients').select('business_name, tier').eq('id', clientId).single()
    const liveMsg = agentId && twilioNumber
      ? `${client?.business_name} is LIVE — agent ${agentId} + number ${twilioNumber}`
      : `${client?.business_name} completed onboarding — manual agent setup needed`

    await supabase.from('notifications').insert({
      type: 'client_live',
      message: liveMsg,
      data: { clientId, agentId, twilioNumber, tier: client?.tier },
    })

    return new Response(
      JSON.stringify({
        success: true,
        agentId,
        twilioNumber,
        status: agentId && twilioNumber ? 'live' : 'onboarded_manual_setup_needed',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[build-agent]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
