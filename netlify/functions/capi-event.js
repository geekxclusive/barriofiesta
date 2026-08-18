// netlify/functions/capi-event.js
//
// Receives PageView / ViewContent / InitiateCheckout events from the browser
// and forwards them to Meta's Conversions API, matched to the client-side
// Pixel call via a shared event_id for deduplication.
//
// Called with fetch(..., {keepalive: true}) so it survives the browser
// navigating away immediately after (e.g. clicking a ticket link).

const { sendCapiEvent, getClientIp } = require('./_shared/metaCapi');

const ALLOWED_EVENTS = ['PageView', 'ViewContent', 'InitiateCheckout'];

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

  const { eventName, eventId, eventSourceUrl, fbp, fbc, customData } = data;

  if (!eventName || !eventId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing eventName or eventId' }) };
  }
  if (!ALLOWED_EVENTS.includes(eventName)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Event not allowed on this endpoint' }) };
  }

  const userData = {
    client_ip_address: getClientIp(event.headers),
    client_user_agent: event.headers['user-agent']
  };
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  await sendCapiEvent({
    eventName: eventName,
    eventId: eventId,
    eventSourceUrl: eventSourceUrl,
    actionSource: 'website',
    userData: userData,
    customData: customData || {}
  });

  // Always respond quickly — this is fire-and-forget from the browser's side,
  // a slow or failed CAPI send should never hold up someone's actual click.
  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
