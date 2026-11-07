import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../worker/index.js', import.meta.url), 'utf8')).replace('__ASSETS__', '{ "/index.html": "<h1>QA Studio</h1>" }');
const { default: app } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const easy = { task_id: 'easy:temple:c1', difficulty: 'easy', entity_name: 'Example Temple', entity_category: 'Architecture / heritage', claims: [{ fact_id: 'c1', aspect: 'period', statement: 'The temple was built in the ninth century.' }] };
const hard = { task_id: 'hard:temple:1', difficulty: 'hard', required_claim_count: 2, entity_name: 'Example Temple', entity_category: 'Architecture / heritage', claims: [{ fact_id: 'c1', aspect: 'period', statement: 'The temple was built in the ninth century.' }, { fact_id: 'c2', aspect: 'restoration', statement: 'It was restored in 1911 using reinforced stone joints.' }] };
const hardCandidates = { ...hard, task_id: 'hard:temple:candidates', claims: [...hard.claims, { fact_id: 'c3', aspect: 'recognition', statement: 'It received heritage recognition in 1991.' }] };
const responseFor = item => ({ items: [{ task_id: item.task_id, qa_pairs: [item.difficulty === 'easy' ? { question: 'When was Example Temple built?', golden_answer: 'Ninth century', answer_type: 'period', source_claim_ids: ['c1'], evidence_excerpts: ['built in the ninth century'] } : { question: 'How do this temple’s construction and restoration represent different historical phases?', golden_answer: 'It was built in the ninth century and restored in 1911 with reinforced stone joints.', answer_type: 'synthesis', source_claim_ids: ['c1', 'c2'], evidence_excerpts: ['built in the ninth century', 'restored in 1911 using reinforced stone joints'] }] }] });

test('Vilao status never exposes its API key', async () => {
  const response = await app.fetch(new Request('http://localhost/api/llm-status'), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret', VILAO_MODEL: 'chib/gemini-3.8-flash' });
  const result = await response.json();
  assert.equal(result.available, true);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('Easy request sends entity and claim, then returns one short grounded answer', async () => {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, request) => { sent = JSON.parse(request.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseFor(easy)) } }] }), { status: 200 }); };
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'open', items: [easy] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    const result = await response.json();
    assert.equal(result.qa_pairs[easy.task_id].length, 1);
    assert.equal(result.qa_pairs[easy.task_id][0].question.includes('Example Temple'), false);
    assert.equal(result.qa_pairs[easy.task_id][0].source_claim_ids.length, 1);
    assert.equal(sent.messages[1].content.includes('ninth century'), true);
    assert.match(sent.messages[0].content, /intentionally underspecified/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Hard request requires and preserves evidence from at least two claims', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseFor(hard)) } }] }), { status: 200 });
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'open', items: [hard] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    const result = await response.json();
    assert.equal(result.qa_pairs[hard.task_id][0].source_claim_ids.length, 2);
    assert.equal(result.qa_pairs[hard.task_id][0].evidence_excerpts.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('Backend retries a hard answer that cites only one claim', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const payload = calls === 1 ? { items: [{ task_id: hard.task_id, qa_pairs: [{ question: 'When was this temple built?', golden_answer: 'Ninth century', source_claim_ids: ['c1'], evidence_excerpts: ['built in the ninth century'] }] }] } : responseFor(hard);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });
  };
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'open', items: [hard] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    const result = await response.json();
    assert.equal(calls, 2);
    assert.equal(result.qa_pairs[hard.task_id].length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('Backend rewrites questions that reveal a country or region', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const pair = calls === 1
      ? { question: 'When was this temple built in Central Vietnam?', golden_answer: 'Ninth century', source_claim_ids: ['c1'], evidence_excerpts: ['built in the ninth century'] }
      : { question: 'During which period was this temple built?', golden_answer: 'Ninth century', source_claim_ids: ['c1'], evidence_excerpts: ['built in the ninth century'] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ task_id: easy.task_id, qa_pairs: [pair] }] }) } }] }), { status: 200 });
  };
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'open', items: [easy] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    const result = await response.json();
    assert.equal(calls, 2);
    assert.equal(result.qa_pairs[easy.task_id][0].question, 'During which period was this temple built?');
  } finally { globalThis.fetch = originalFetch; }
});

test('Hard QA selects the configured number of related claims from a larger candidate pool', async () => {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, request) => {
    sent = JSON.parse(request.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ task_id: hardCandidates.task_id, qa_pairs: [{ question: 'How did this temple change between its construction and restoration?', golden_answer: 'It was built in the ninth century and restored in 1911.', source_claim_ids: ['c1', 'c2'], evidence_excerpts: ['built in the ninth century', 'restored in 1911'] }] }] }) } }] }), { status: 200 });
  };
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'open', items: [hardCandidates] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    const result = await response.json();
    assert.equal(result.qa_pairs[hardCandidates.task_id][0].source_claim_ids.length, 2);
    assert.equal(JSON.parse(sent.messages[1].content).items[0].claims.length, 3);
    assert.equal(JSON.parse(sent.messages[1].content).items[0].required_claim_count, 2);
    assert.match(sent.messages[0].content, /strongest natural semantic relationship/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Vilao rate limits are forwarded for browser retry', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":"rate limit"}', { status: 429, headers: { 'retry-after': '7' } });
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'open', items: [easy] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).retry_after_seconds, 7);
  } finally { globalThis.fetch = originalFetch; }
});
