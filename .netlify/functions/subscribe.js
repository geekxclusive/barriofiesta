// netlify/functions/subscribe.js
//
// Receives submissions from the Guide signup form and the Badge claim form,
// then adds/updates the contact in Brevo via their REST API.
//
// Required environment variables (Netlify: Site settings -> Environment variables):
//   BREVO_API_KEY        - your Brevo API key (Brevo dashboard -> SMTP & API -> API Keys)
//   BREVO_GUIDE_LIST_ID   - the numeric list ID for "Guide Requesters" in Brevo
//   BREVO_CLAIM_LIST_ID   - the numeric list ID for "Badge Claims (Pending Verification)" in Brevo
//
// Never put the API key directly in this file or in any front-end code —
// it must only ever live in Netlify's environment variables.

exports.handler = async function (event) {
  console.log('subscribe: invoked, method =', event.httpMethod);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    console.log('subscribe: failed to parse JSON body');
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { type, name, email, tier, ref, marketingOptin, botField } = data;
  console.log('subscribe: parsed body, type =', type, 'email present =', !!email);

  if (botField) {
    console.log('subscribe: honeypot triggered, silently succeeding without processing');
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  if (!type || !name || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email address' }) };
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    console.log('subscribe: BREVO_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured (missing API key)' }) };
  }
  console.log('subscribe: API key present, length =', BREVO_API_KEY.length);

  let listId;
  const attributes = { FIRSTNAME: name };

  if (type === 'guide') {
    listId = process.env.BREVO_GUIDE_LIST_ID;
    attributes.MARKETING_OPTIN = !!marketingOptin;
  } else if (type === 'claim') {
    listId = process.env.BREVO_CLAIM_LIST_ID;
    attributes.TIER = tier || '';
    attributes.BOOKING_REF = ref || '';
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown submission type' }) };
  }

  if (!listId) {
    console.log('subscribe: list ID not set for type =', type);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured (missing list ID for "' + type + '")' }) };
  }
  console.log('subscribe: using list ID =', listId, 'for type =', type);

  // Guard against the request to Brevo hanging indefinitely (a known behavior
  // of Node's built-in fetch in some Lambda-based environments). If Brevo
  // doesn't respond within 8 seconds, we abort and return a clear error
  // instead of letting Netlify's own gateway silently kill the function.
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 8000);

  try {
    console.log('subscribe: calling Brevo...');
    const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        email: email,
        attributes: attributes,
        listIds: [parseInt(listId, 10)],
        updateEnabled: true
      }),
      signal: controller.signal,
      keepalive: false
    });
    clearTimeout(timeout);
    console.log('subscribe: Brevo responded with status', brevoRes.status);

    if (brevoRes.status !== 201 && brevoRes.status !== 204) {
      const errBody = await brevoRes.text();
      console.error('subscribe: Brevo API error:', brevoRes.status, errBody);
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach email provider' }) };
    }

    console.log('subscribe: success');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error('subscribe: Brevo request timed out after 8s');
      return { statusCode: 504, body: JSON.stringify({ error: 'Email provider timed out' }) };
    }
    console.error('subscribe: unexpected error:', err.message, err.stack);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error' }) };
  }
};
