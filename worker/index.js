const ASSETS = __ASSET_MAP__;
const KB_ORIGIN = 'https://icmr-kb-review.icmr.workers.dev';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

function assetResponse(pathname) {
  const name = pathname === '/' ? '/index.html' : pathname;
  const asset = ASSETS[name];
  if (!asset) return null;
  return new Response(asset.body, { headers: {
    'Content-Type': asset.type,
    'Cache-Control': name === '/index.html' ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff'
  } });
}

async function kbSession(username, password) {
  const landing = await fetch(`${KB_ORIGIN}/login`, { cache: 'no-store', headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' } });
  const landingCookies = typeof landing.headers.getSetCookie === 'function' ? landing.headers.getSetCookie() : [landing.headers.get('set-cookie')].filter(Boolean);
  const initialCookie = landingCookies.map(value => value.split(';')[0]).filter(Boolean).join('; ');
  const login = await fetch(`${KB_ORIGIN}/api/login`, {
    method: 'POST', redirect: 'manual', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': KB_ORIGIN, 'Referer': `${KB_ORIGIN}/login`, 'User-Agent': USER_AGENT, ...(initialCookie ? { Cookie: initialCookie } : {}) },
    body: JSON.stringify({ username, password })
  });
  if (!login.ok) throw new Error('Không đăng nhập được KB. Kiểm tra tài khoản và mật khẩu.');
  const cookies = typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : [login.headers.get('set-cookie')].filter(Boolean);
  const cookie = cookies.map(value => value.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('KB không trả về phiên đăng nhập.');
  return cookie;
}

async function kbGet(path, cookie) {
  const response = await fetch(`${KB_ORIGIN}/api${path}`, {
    cache: 'no-store', headers: { 'Accept': 'application/json', 'Cookie': cookie, 'Referer': `${KB_ORIGIN}/entities`, 'User-Agent': USER_AGENT }
  });
  if (!response.ok) throw new Error(`KB trả về lỗi ${response.status} khi đọc ${path}.`);
  return response.json();
}

function compactEntity(detail) {
  const entity = detail.entity;
  return {
    id: entity.entity_id, name: entity.name, localName: entity.local_name || '',
    country: entity.country_id || '', category: entity.category_id || '',
    facts: (detail.claims || []).map(claim => ({
      id: claim.claim_id, aspect: claim.aspect_id, aspect_label: claim.display_name || claim.aspect_id,
      answer: claim.claim_text, statement: claim.claim_text, raw: true,
      status: String(claim.status || 'PENDING').toLowerCase(),
      source_refs: (claim.sources || []).map(source => ({
        source_id: source.source_id, title: source.title, url: source.source_url,
        locator: source.supporting_locator, evidence_id: source.evidence_id
      })),
      source: (claim.sources || []).map(source => source.title && source.source_url ? `${source.title} (${source.source_url})` : source.source_url || source.title || source.source_id).filter(Boolean).join('; ')
    }))
  };
}

async function handleKb(request, path) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Yêu cầu khác nguồn không được chấp nhận.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Cần gửi JSON.' }, 415);
  if (Number(request.headers.get('content-length') || 0) > 12000) return json({ error: 'Yêu cầu quá lớn.' }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON không hợp lệ.' }, 400); }
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password || username.length > 100 || password.length > 200) return json({ error: 'Thiếu tài khoản hoặc mật khẩu hợp lệ.' }, 400);
  try {
    const cookie = await kbSession(username, password);
    const listing = await kbGet('/entities', cookie);
    const all = listing.entities || [];
    if (path.endsWith('/list')) return json({ entities: all.map(entity => ({
      entity_id: entity.entity_id, name: entity.name, claim_count: entity.claim_count,
      approved: entity.approved, category_id: entity.category_id, country_id: entity.country_id
    })) });
    const ids = body.entityIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some(id => typeof id !== 'string')) return json({ error: 'Chọn từ 1 đến 30 entity.' }, 400);
    const validIds = new Set(all.map(entity => entity.entity_id));
    if (ids.some(id => !validIds.has(id))) return json({ error: 'Danh sách có entity không tồn tại trong KB.' }, 400);
    const results = new Array(ids.length);
    const errors = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(6, ids.length) }, async () => {
      while (cursor < ids.length) {
        const index = cursor++;
        try { results[index] = compactEntity(await kbGet(`/entities/${encodeURIComponent(ids[index])}`, cookie)); }
        catch (error) { errors.push({ entity_id: ids[index], error: error.message }); }
      }
    }));
    return json({ entities: results.filter(Boolean), errors });
  } catch (error) { return json({ error: error.message || 'Không đọc được KB.' }, 502); }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && ['/api/kb/list', '/api/kb/sync'].includes(url.pathname)) return handleKb(request, url.pathname);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const asset = assetResponse(url.pathname);
    if (asset) return request.method === 'HEAD' ? new Response(null, { status: asset.status, headers: asset.headers }) : asset;
    return new Response('Not found', { status: 404 });
  }
};
