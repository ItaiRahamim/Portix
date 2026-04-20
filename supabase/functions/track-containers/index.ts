import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const { container_number } = await req.json();

    // CRITICAL: .trim() removes any hidden newlines from Supabase secrets
    const clientId = (Deno.env.get("MAERSK_CLIENT_ID") || "").trim();
    const clientSecret = (Deno.env.get("MAERSK_CLIENT_SECRET") || "").trim();

    // 1. AUTHENTICATION (Using URLSearchParams which worked perfectly before)
    const authParams = new URLSearchParams();
    authParams.append("grant_type", "client_credentials");
    authParams.append("client_id", clientId);
    authParams.append("client_secret", clientSecret);

    const authRes = await fetch("https://api.maersk.com/oauth2/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: authParams
    });

    if (!authRes.ok) {
      const authErr = await authRes.text();
      return new Response(JSON.stringify({ error: `Auth Failed: ${authErr}` }), { status: 400 });
    }

    const { access_token } = await authRes.json();

    // 2. FETCH TRACKING DATA (Correct DCSA Endpoint based on token scopes)
    const trackUrl = `https://api.maersk.com/track-and-trace/events?equipmentReference=${container_number}`;

    const trackRes = await fetch(trackUrl, {
      headers: {
        "Authorization": `Bearer ${access_token}`,
        "Consumer-Key": clientId,
        "Accept": "application/json"
      }
    });

    const data = await trackRes.json();

    // Return response directly to Supabase dashboard
    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})
