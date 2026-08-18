// netlify/functions/subscribe.js
//
// Receives submissions from the Guide signup form and the Badge claim form.
// For each: adds/updates the contact in Brevo, then fires a matching
// server-side Meta Conversions API event (Lead or CompleteRegistration),
// using the same event_id the browser's Pixel call already used so Meta
// can deduplicate the two instead of double-counting.
//
// Required environment variables (Netlify: Site settings -> Environment variables):
//   BREVO_API_KEY         - Brevo API key (Brevo dashboard -> SMTP & API -> API Keys)
//   BREVO_GUIDE_LIST_ID    - numeric list ID for "Guide Requesters" in Brevo
//   BREVO_CLAIM_LIST_ID    - numeric list ID for "Badge Claims (Pending Verification)"
//   META_PIXEL_ID          - numeric Pixel/dataset ID (e.g. 917325006493038)
//   META_ACCESS_TOKEN      - Conversions API access token for that Pixel
//
// Never put any of these directly in this file or in front-end code — they
// must only ever live in Netlify's environment variables.

const { sendCapiEvent, getClientIp } = require('./_shared/metaCapi');

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

  const { type, name, email, tier, ref, marketingOptin, botField, eventId, eventSourceUrl, fbp, fbc } = data;

  // Honeypot: a filled hidden field almost certainly means a bot. Respond
  // with success (so the bot learns nothing useful) but do nothing further.
  if (botField) {
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
        updateEnabled: true
      })
    });

    if (brevoRes.status !== 201 && brevoRes.status !== 204) {
      const errBody = await brevoRes.text();
      console.error('Brevo API error:', brevoRes.status, errBody);
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach email provider' }) };
    }

    // Brevo succeeded — now fire the matching server-side Meta event.
    // This runs after Brevo on purpose: we only want to tell Meta about a
    // Lead/CompleteRegistration once we know the submission was actually valid.
    const capiEventName = type === 'guide' ? 'Lead' : 'CompleteRegistration';
    const userData = {
      client_ip_address: getClientIp(event.headers),
      client_user_agent: event.headers['user-agent']
    };
    if (fbp) userData.fbp = fbp;
    if (fbc) userData.fbc = fbc;

    const customData = type === 'guide'
      ? { content_name: 'VIP Decision Guide' }
      : { content_name: 'Badge Claim', content_category: tier || 'unspecified' };

    await sendCapiEvent({
      eventName: capiEventName,
      eventId: eventId,
      eventSourceUrl: eventSourceUrl,
      actionSource: 'website',
      userData: userData,
      customData: customData
    });

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
