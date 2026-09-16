import { readTicket } from './chatTicket.js';
import {
  setRealtimeSender,
  registerConnection,
  dropConnection,
  touchConnection,
} from '../services/chatRealtime.service.js';

/**
 * API Gateway WebSocket ke teen route — $connect, $disconnect, $default.
 *
 * Ye Express se BILKUL alag raasta hai: WebSocket event me na koi HTTP method hota hai
 * na path, isliye inhe serverless-http ke through bhejna bekaar hai. lambda.js in events
 * ko pehchan kar seedha yahan bhej deta hai.
 *
 * Sender yahin lagta hai: PostToConnection ko usi Lambda se bulaya jaata hai jo message
 * likhta hai, isliye ek hi jagah set kar dena kaafi hai.
 */

let sdk = null;

/**
 * PostToConnection wala sender — sirf tab banta hai jab CHAT_WS_ENDPOINT set ho.
 *
 * Endpoint na ho to sender lagta hi nahi, aur poora chat chupchap polling par chalta
 * rehta hai. Yaani WebSocket ON karna sirf env var + console ka kaam hai; code pehle se
 * dono haalat sambhalta hai.
 */
export async function initChatSocket() {
  const endpoint = process.env.CHAT_WS_ENDPOINT;
  if (!endpoint || sdk) return;
  const { ApiGatewayManagementApiClient, PostToConnectionCommand } = await import(
    '@aws-sdk/client-apigatewaymanagementapi'
  );
  const client = new ApiGatewayManagementApiClient({ endpoint });
  sdk = { client, PostToConnectionCommand };
  setRealtimeSender(async (connectionId, body) => {
    await client.send(new sdk.PostToConnectionCommand({ ConnectionId: connectionId, Data: body }));
  });
}

/**
 * Kya ye Lambda event WebSocket ka hai?
 *
 * Jaan-bujh kar sakht: `connectionId` HONA chahiye aur HTTP wali nishaniyan (`http` v2
 * me, `httpMethod` v1 me) NAHI honi chahiye. Dheela check ek din kisi asli HTTP request
 * ko socket handler me bhej deta aur poora API "ok" lautane lagta — bina kisi error ke.
 */
export function isSocketEvent(event) {
  const rc = event?.requestContext;
  if (!rc || !rc.connectionId) return false;
  if (rc.http || rc.httpMethod) return false;
  return true;
}

/**
 * $connect / $disconnect / $default.
 *
 * $connect par parchi (ticket) query string se aati hai. Galat ya purani parchi par 401 —
 * API Gateway tab handshake hi poora nahi karta.
 *
 * $default par client ke do hi kaam hote hain: `ping` (connection ko 10-minute ke idle
 * timeout se pehle zinda rakhna) aur `open` (kaun si chat saamne khuli hai — isi se tay
 * hota hai ki uska push bhejna hai ya nahi).
 */
export async function handleSocketEvent(event) {
  const rc = event.requestContext || {};
  const { routeKey, connectionId } = rc;

  if (routeKey === '$connect') {
    const ticket = event.queryStringParameters?.ticket;
    const userId = readTicket(ticket);
    if (!userId) return { statusCode: 401, body: 'Unauthorized' };
    await registerConnection(userId, connectionId, {
      userAgent: event.headers?.['User-Agent'] || event.headers?.['user-agent'] || '',
    });
    return { statusCode: 200, body: 'connected' };
  }

  if (routeKey === '$disconnect') {
    await dropConnection(connectionId);
    return { statusCode: 200, body: 'disconnected' };
  }

  // $default — client ka apna chhota protocol.
  let msg = {};
  try {
    msg = JSON.parse(event.body || '{}');
  } catch {
    msg = {};
  }
  if (msg.type === 'ping') {
    await touchConnection(connectionId, { activeConversation: msg.conversationId || null });
  } else if (msg.type === 'open') {
    await touchConnection(connectionId, { activeConversation: msg.conversationId || null });
  }
  return { statusCode: 200, body: 'ok' };
}
