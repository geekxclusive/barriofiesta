// netlify/functions/_shared/metaCapi.js
//
// Shared helper for sending server-side events to Meta's Conversions API.
// Used by subscribe.js (Lead, CompleteRegistration) and capi-event.js
// (PageView, ViewContent, InitiateCheckout).
//
// Required environment variables:
//   META_PIXEL_ID       - the numeric Pixel/dataset ID (e.g. 917325006493038)
//   META_ACCESS_TOKEN    - a Conversions API access token for that Pixel
//                          (Events Manager -> Pixel -> Settings -> Conversions API
//                          -> Set up manually -> Generate access token)
//   META_TEST_EVENT_CODE - optional, only set while verifying in Meta's
//                          Test Events tool. Remove/leave unset in production.
//
// We deliberately do NOT send email or phone in user_data here, since none of
// the events wired up need that level of matching — fbp/fbc/IP/user-agent are
// enough for the events in play and keeps this server sending less personal
// data than it could. If Purchase tracking is ever added, revisit this.

const GRAPH_API_VERSION = 'v19.0';

async function sendCapiEvent({ eventName, eventId, eventSourceUrl, actionSource, userData, customData }) {
  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.log('metaCapi: skipped (META_PIXEL_ID or META_ACCESS_TOKEN not set)');
    return { skipped: true };
  }
  if (!eventId) {
    console.log('metaCapi: skipped (no eventId provided, can\'t deduplicate against browser Pixel)');
    return { skipped: true };
  }

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      event_source_url: eventSourceUrl,
      action_source: actionSource || 'website',
      user_data: userData || {},
      custom_data: customData || {}
    }],
    access_token: ACCESS_TOKEN
  };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PIXEL_ID}/events`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json();
    if (!res.ok) {
      console.error('metaCapi: Meta API error', res.status, JSON.stringify(body));
    } else {
      console.log('metaCapi: sent', eventName, eventId, JSON.stringify(body));
    }
    return body;
  } catch (err) {
    console.error('metaCapi: request failed:', err.message);
    return { error: err.message };
  }
}

function getClientIp(headers) {
  // Netlify forwards the real client IP via this header.
  const xff = headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return undefined;
}

module.exports = { sendCapiEvent, getClientIp };
