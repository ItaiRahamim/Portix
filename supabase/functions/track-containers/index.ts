import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const { container_number } = await req.json();
    const clientId = Deno.env.get("MAERSK_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("MAERSK_CLIENT_SECRET") || "";

    // 1. DUMB RAW STRING - EXACTLY LIKE CURL (No URLSearchParams)
    const bodyString = `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;

    const authRes = await fetch("https://api.maersk.com/oauth2/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bodyString
    });

    if (!authRes.ok) {
      const authErr = await authRes.text();
      return new Response(JSON.stringify({ error: `Auth Failed: ${authErr}` }), { status: 400 });
    }

    const { access_token } = await authRes.json();

    // 2. FETCH TRACKING DATA (Using Proprietary Ocean T&T Endpoint)
    const trackUrl = `https://api.maersk.com/track-and-trace/equipments?equipmentNumber=${container_number}`;

    const trackRes = await fetch(trackUrl, {
      headers: {
        "Authorization": `Bearer ${access_token}`,
        "Consumer-Key": clientId,
        "Accept": "application/json"
      }
    });

    const data = await trackRes.json();
    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})
