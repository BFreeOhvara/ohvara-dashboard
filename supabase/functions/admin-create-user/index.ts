import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { email, password, full_name, role, phone } = await req.json()

  if (!email || !password || !full_name || !role) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // 1. Create auth user (email confirmed immediately — no verification step)
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role, phone },
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // 2. Generate a password-reset link so the user can set their own password
  //    (they can also log in immediately with the temp password Brayden set)
  let resetLink: string | null = null
  try {
    const dashboardUrl = Deno.env.get('DASHBOARD_URL') || 'https://ohvara-dashboard.vercel.app'
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: dashboardUrl },
    })
    resetLink = linkData?.properties?.action_link || null
  } catch { /* non-fatal */ }

  // 3. Send welcome email via SendGrid
  //    WIRE-THIS: set SENDGRID_API_KEY in Supabase Edge Function secrets
  //    Dashboard → Edge Functions → Manage Secrets → SENDGRID_API_KEY
  const sendgridKey = Deno.env.get('SENDGRID_API_KEY')
  if (sendgridKey) {
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)
    const emailBody = `
Hi ${full_name},

Your Ohvara Outreach Dashboard account has been created.

Role: ${roleLabel}
Email: ${email}
Temporary password: ${password}

Log in at: ${Deno.env.get('DASHBOARD_URL') || 'https://ohvara-dashboard.vercel.app'}

${resetLink ? `To set your own password, use this link (expires in 1 hour):\n${resetLink}` : ''}

— Ohvara Team
    `.trim()

    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email, name: full_name }] }],
        from: { email: Deno.env.get('SENDGRID_FROM_EMAIL') || 'noreply@ohvara.com', name: 'Ohvara' },
        subject: `Welcome to Ohvara — your ${roleLabel} account is ready`,
        content: [{ type: 'text/plain', value: emailBody }],
      }),
    }).catch(() => { /* non-fatal — user was still created */ })
  }
  // If no SENDGRID_API_KEY, user is created but email is not sent.
  // Add SENDGRID_API_KEY and SENDGRID_FROM_EMAIL to Edge Function secrets to enable.

  return new Response(
    JSON.stringify({
      user: data.user,
      email_sent: !!sendgridKey,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
