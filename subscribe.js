// netlify/functions/subscribe.js
//
// Receives submissions from the Guide signup form and the Badge claim form,
// then adds/updates the contact in Brevo via their REST API.
//
// Required environment variables (set in Netlify: Site settings -> Environment variables):
//   BREVO_API_KEY        - your Brevo API key (Brevo dashboard -> SMTP & API -> API Keys)
//   BREVO_GUIDE_LIST_ID   - the numeric list ID for "Guide Requesters" in Brevo
//   BREVO_CLAIM_LIST_ID   - the numeric list ID for "Badge Claims (Pending Verification)" in Brevo
//
// Never put the API key directly in this file or in any front-end code —
// it must only ever live in Netlify's environment variables.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { type, name, email, tier, ref, marketingOptin, botField } = data;

  // Server-side honeypot check: a filled hidden field almost certainly means a bot.
  // Respond with success (so the bot doesn't learn anything useful) but do nothing.
  if (botField) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  // Basic validation
  if (!type || !name || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email address' }) };
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured (missing API key)' }) };
  }

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
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured (missing list ID for "' + type + '")' }) };
  }

  try {
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
        updateEnabled: true // if the contact already exists, update them and add to this list rather than failing
      })
    });

    // Brevo returns 201 (created) or 204 (updated) on success.
    if (brevoRes.status !== 201 && brevoRes.status !== 204) {
      const errBody = await brevoRes.text();
      console.error('Brevo API error:', brevoRes.status, errBody);
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach email provider' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error' }) };
  }
};
