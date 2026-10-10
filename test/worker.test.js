import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

test('KB proxy reads selected entities without returning credentials or review records', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/api/login')) return new Response(JSON.stringify({ user: { role: 'MEMBER' } }), { headers: { 'Set-Cookie': 'session=test-session; HttpOnly; Secure' } });
    if (String(url).endsWith('/login')) return new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
    if (String(url).endsWith('/api/entities')) return Response.json({ entities: [{ entity_id: 'E1', name: 'Entity 1', claim_count: 1, approved: 0 }] });
    if (String(url).endsWith('/api/entities/E1')) return Response.json({
      entity: { entity_id: 'E1', name: 'Entity 1', country_id: 'cambodia', category_id: 'architecture_heritage' },
      claims: [{ claim_id: 'C1', aspect_id: 'architecture_heritage.history', display_name: 'History', claim_text: 'Entity 1 was founded in 1200.', status: 'IN_PROGRESS', sources: [{ title: 'Source', source_url: 'https://example.test/source' }], reviews: [{ private: true }] }]
    });
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const request = new Request('https://studio.test/api/kb/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://studio.test' }, body: JSON.stringify({ username: 'user', password: 'secret', entityIds: ['E1'] }) });
    const response = await worker.fetch(request);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.entities[0].facts[0].status, 'in_progress');
    assert.equal(body.entities[0].facts[0].aspect_label, 'History');
    assert.ok(!JSON.stringify(body).includes('secret'));
    assert.ok(!JSON.stringify(body).includes('private'));
    assert.equal(calls.length, 4);
    assert.match(calls[3].options.headers.Cookie, /session=test-session/);
  } finally { globalThis.fetch = originalFetch; }
});

test('KB proxy rejects cross-origin requests before login', async () => {
  const response = await worker.fetch(new Request('https://studio.test/api/kb/list', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://elsewhere.test' }, body: '{}' }));
  assert.equal(response.status, 403);
});
