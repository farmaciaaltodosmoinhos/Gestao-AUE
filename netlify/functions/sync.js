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
//
// Configuração do Netlify Blobs:
// - Normalmente não é preciso configurar nada — o Netlify liga automaticamente as
//   Functions ao Blobs do próprio site.
// - Se aparecer o erro "MissingBlobsEnvironmentError" (ou "blobs_unavailable"), configure
//   manualmente estas duas variáveis de ambiente no site (Project configuration →
//   Environment variables), depois volte a publicar o site:
//     AUE_BLOBS_SITE_ID = o "Project ID" do site (Project configuration → General)
//     AUE_BLOBS_TOKEN   = um Personal Access Token (User settings → Applications →
//                         New access token)
//   Isto é apenas um mecanismo de recurso — a maioria dos sites não precisa disto.

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

// Constrói o store. Se existirem as variáveis de ambiente manuais, usa-as sempre
// (é a forma mais fiável); caso contrário, deixa o Netlify configurar tudo sozinho.
function buildStore() {
  const manualSiteID = process.env.AUE_BLOBS_SITE_ID;
  const manualToken = process.env.AUE_BLOBS_TOKEN;
  if (manualSiteID && manualToken) {
    return getStore({ name: STORE_NAME, siteID: manualSiteID, token: manualToken });
  }
  return getStore(STORE_NAME);
}

function describeError(err) {
  const name = (err && err.name) || 'Error';
  const message = String((err && err.message) || err);
  const isMissingEnv = name === 'MissingBlobsEnvironmentError' || /siteID|token/i.test(message);
  return {
    error: 'blobs_unavailable',
    errorName: name,
    message: isMissingEnv
      ? 'O Netlify não conseguiu ligar automaticamente esta função ao Blobs deste site. ' +
        'Configure as variáveis de ambiente AUE_BLOBS_SITE_ID e AUE_BLOBS_TOKEN (ver comentário ' +
        'no topo de netlify/functions/sync.js) e volte a publicar o site. Detalhe técnico: ' + message
      : 'Falha ao aceder ao Netlify Blobs. Detalhe técnico: ' + message,
  };
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
    store = buildStore();
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify(describeError(err)) };
  }

  try {
    if (event.httpMethod === 'GET') {
      let raw = null;
      try {
        raw = await store.get(BLOB_KEY, { type: 'text' });
      } catch (err) {
        // Erro real de acesso ao Blobs (ex.: MissingBlobsEnvironmentError) — devolve
        // o motivo exato em vez de mascarar como "sem dados ainda".
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify(describeError(err)) };
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
      let readFailed = false;
      let readErr = null;
      try {
        const existingRaw = await store.get(BLOB_KEY, { type: 'text' });
        if (existingRaw) {
          const parsed = JSON.parse(existingRaw);
          if (Array.isArray(parsed.pedidos)) existing = parsed;
        }
      } catch (e) {
        readFailed = true;
        readErr = e;
      }

      const merged = mergePedidos(existing.pedidos, payload.pedidos);
      const toStore = { pedidos: merged, updatedAt: Date.now() };
      try {
        await store.set(BLOB_KEY, JSON.stringify(toStore));
      } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify(describeError(err)) };
      }

      if (readFailed) {
        // A escrita funcionou mas não conseguimos ler o estado anterior antes de escrever —
        // avisa (não é um erro fatal, mas convém saber-se).
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ ...toStore, warning: 'leitura_anterior_falhou: ' + String((readErr && readErr.message) || readErr) }),
        };
      }
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
