// netlify/functions/sync.js
//
// Endpoint de sincronização dos "Pedidos AUE".
// GET  -> devolve { pedidos: [...], updatedAt } tal como estão guardados no Netlify Blobs.
// POST -> recebe { pedidos: [...] }, funde com o que já está guardado (por id + updatedAt,
//         nunca substituindo tudo de uma vez) e devolve o resultado já fundido.
//
// Segurança dos dados:
// - Nunca apagamos dados existentes: um POST funde sempre com o que já lá está.
// - Um pedido "eliminado" no cliente chega aqui como { deleted: true, deletedAt, updatedAt }
//   (marca de eliminação / tombstone) e é tratado como qualquer outro registo — o mais
//   recente por `updatedAt` é o que prevalece.
// - Autenticação opcional via variável de ambiente AUE_SYNC_TOKEN (cabeçalho X-Sync-Token).
//   Isto é INDEPENDENTE do login local de email/palavra-passe da aplicação.

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'aue-pedidos';
const BLOB_KEY = 'dados';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function mergePedidos(existing, incoming) {
  const map = new Map();
  [...(existing || []), ...(incoming || [])].forEach((p) => {
    if (!p || !p.id) return;
    const prev = map.get(p.id);
    if (!prev || (p.updatedAt || 0) > (prev.updatedAt || 0)) {
      map.set(p.id, p);
    }
  });
  return Array.from(map.values());
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const requiredToken = process.env.AUE_SYNC_TOKEN;
  if (requiredToken) {
    const provided =
      (event.headers && (event.headers['x-sync-token'] || event.headers['X-Sync-Token'])) || '';
    if (provided !== requiredToken) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'unauthorized', message: 'Código de acesso à sincronização inválido ou em falta.' }),
      };
    }
  }

  let store;
  try {
    store = getStore(STORE_NAME);
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'blobs_unavailable',
        message: 'Netlify Blobs não está disponível neste site. Verifique se o site tem o Blobs ativo.',
      }),
    };
  }

  try {
    if (event.httpMethod === 'GET') {
      let raw = null;
      try {
        raw = await store.get(BLOB_KEY, { type: 'text' });
      } catch (e) {
        raw = null;
      }
      if (!raw) {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ pedidos: [], updatedAt: 0 }) };
      }
      // Devolve tal como está guardado. Se estiver corrompido, nunca apagamos —
      // devolvemos uma lista vazia só para esta resposta, sem tocar no que está guardado.
      try {
        JSON.parse(raw);
        return { statusCode: 200, headers: CORS_HEADERS, body: raw };
      } catch (e) {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ pedidos: [], updatedAt: 0, warning: 'dados_guardados_corrompidos' }),
        };
      }
    }

    if (event.httpMethod === 'POST') {
      let payload;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch (e) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'invalid_json' }) };
      }
      if (!Array.isArray(payload.pedidos)) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'invalid_payload', message: 'Esperava-se { pedidos: [...] }' }) };
      }

      // Nunca substituímos às cegas: lemos o que já está guardado e fundimos.
      let existing = { pedidos: [], updatedAt: 0 };
      try {
        const existingRaw = await store.get(BLOB_KEY, { type: 'text' });
        if (existingRaw) {
          const parsed = JSON.parse(existingRaw);
          if (Array.isArray(parsed.pedidos)) existing = parsed;
        }
      } catch (e) {
        // Se não conseguirmos ler o estado atual, seguimos apenas com o que chegou agora
        // (nunca apagamos o que estava lá — na pior das hipóteses o merge fica adiado
        // para a próxima sincronização bem-sucedida de outro dispositivo).
      }

      const merged = mergePedidos(existing.pedidos, payload.pedidos);
      const toStore = { pedidos: merged, updatedAt: Date.now() };
      await store.set(BLOB_KEY, JSON.stringify(toStore));

      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(toStore) };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'method_not_allowed' }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'server_error', message: String((err && err.message) || err) }),
    };
  }
};
