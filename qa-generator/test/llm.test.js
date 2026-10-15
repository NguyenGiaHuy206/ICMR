import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../worker/index.js', import.meta.url), 'utf8')).replace('__ASSETS__', '{ "/index.html": "<h1>QA Studio</h1>" }');
const { default: app } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const item = { fact_id: 'borobudur-history', entity_name: 'Borobudur', entity_category: 'Công trình / di sản', aspect: 'historical_significance', statement: 'Borobudur được hoàn thành vào năm 825. Công trình được UNESCO ghi danh Di sản thế giới năm 1991.', questions_per_fact: 2 };

test('Vilao status never exposes its API key', async () => {
  const response = await app.fetch(new Request('http://localhost/api/llm-status'), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret', VILAO_MODEL: 'chib/gemini-3.8-flash' });
  const result = await response.json();
  assert.deepEqual(result, { available: true, provider: 'vilao', model: 'chib/gemini-3.8-flash', reason: null });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('Vilao receives long fact, entity name and requested QA count, then returns multiple grounded pairs', async () => {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, request) => {
    sent = { url, headers: request.headers, body: JSON.parse(request.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ fact_id: item.fact_id, qa_pairs: [
      { question: 'When was Borobudur completed?', golden_answer: '825 CE', answer_type: 'year', distractors: ['780 CE', '833 CE', '842 CE'], evidence_excerpt: 'completed Borobudur in 825 CE' },
      { question: 'When was this monument designated a World Heritage Site?', golden_answer: '1991', answer_type: 'year', distractors: ['1973', '1982', '2012'], evidence_excerpt: 'World Heritage Site in 1991' }
    ] }]) } }] }), { status: 200 });
  };
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'mcq', items: [item] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.qa_pairs[item.fact_id].length, 2);
    assert.equal(result.qa_pairs[item.fact_id][0].question.includes('Borobudur'), false);
    assert.match(result.qa_pairs[item.fact_id][0].question, /this structure/i);
    assert.equal(result.qa_pairs[item.fact_id][0].distractors.length, 3);
    assert.equal(sent.url, 'https://api.vilao.ai/v1/chat/completions');
    assert.equal(sent.headers.authorization, 'Bearer secret');
    assert.equal(sent.body.model, 'chib/gemini-3.8-flash');
    assert.match(sent.body.messages[0].content, /golden_answer/);
    assert.match(sent.body.messages[0].content, /intentionally underspecified/);
    assert.match(sent.body.messages[0].content, /Avoid the mechanical phrase “in the image”/);
    assert.equal(sent.body.messages[1].content.includes(item.statement), true);
    assert.equal(sent.body.messages[1].content.includes('"questions_per_fact":2'), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('Open QA does not require distractors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ fact_id: item.fact_id, qa_pairs: [{ question: 'During which period was this temple built?', golden_answer: 'The ninth century', answer_type: 'period', distractors: [], evidence_excerpt: 'built in the ninth century' }] }] }) } }] }), { status: 200 });
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'open', items: [item] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    assert.equal((await response.json()).qa_pairs[item.fact_id].length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('Vilao rate limits are forwarded so the browser can wait and retry', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":"rate limit"}', { status: 429, headers: { 'retry-after': '7' } });
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'mcq', items: [item] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    assert.equal(response.status, 429);
    const result = await response.json();
    assert.equal(result.retry_after_seconds, 7);
    assert.match(result.error, /HTTP 429/);
  } finally { globalThis.fetch = originalFetch; }
});


test('Vilao accepts common single-fact response shapes and aliases', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    [{ query: 'What role does this object play?', answer: 'It accompanies ceremonial singing.', type: 'function', incorrect_answers: ['It measures time.', 'It stores grain.', 'It marks property lines.'], evidence: 'accompanies ceremonial singing' }],
    { qa_pairs: [{ question: 'How is this object transmitted?', correct_answer: 'Through oral teaching.', answerType: 'method', choices: ['Through printed manuals.', 'Through state examinations.', 'Through factory training.', 'Through oral teaching.'], supporting_text: 'transmitted through oral teaching' }] }
  ];
  try {
    for (const content of responses) {
      globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Here is the JSON:\n\x60\x60\x60json\n' + JSON.stringify(content) + '\n\x60\x60\x60' } }] }), { status: 200 });
      const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'mcq', items: [{ ...item, questions_per_fact: 1 }] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.qa_pairs[item.fact_id].length, 1);
      assert.equal(result.qa_pairs[item.fact_id][0].distractors.length, 3);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('API explains why every returned QA was rejected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ qa_pairs: [{ question: 'When was this structure completed?', golden_answer: '825', distractors: ['800', '800'] }] }) } }] }), { status: 200 });
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'mcq', items: [{ ...item, questions_per_fact: 1 }] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    const result = await response.json();
    assert.deepEqual(result.qa_pairs[item.fact_id], []);
    assert.match(result.warnings[item.fact_id][0], /1\/3 distractor/);
  } finally { globalThis.fetch = originalFetch; }
});


test('Backend repairs an MCQ when the first response has fewer than three distractors', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, request) => {
    calls++;
    const pair = calls === 1
      ? { question: 'What ritual role does this object have?', golden_answer: 'It is used in a healing rite.', answer_type: 'ritual role', distractors: ['It is used at weddings.'], evidence_excerpt: 'used in a healing rite' }
      : { question: 'What ritual role does this object have?', golden_answer: 'It is used in a healing rite.', answer_type: 'ritual role', distractors: ['It is used at weddings.', 'It is displayed during harvest rites.', 'It accompanies initiation ceremonies.'], evidence_excerpt: 'used in a healing rite' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ fact_id: item.fact_id, qa_pairs: [pair] }] }) } }] }), { status: 200 });
  };
  try {
    const response = await app.fetch(new Request('http://localhost/api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'mcq', items: [{ ...item, questions_per_fact: 1 }] }) }), { LLM_PROVIDER: 'vilao', VILAO_API_KEY: 'secret' });
    const result = await response.json();
    assert.equal(calls, 2);
    assert.equal(result.qa_pairs[item.fact_id].length, 1);
    assert.equal(result.qa_pairs[item.fact_id][0].distractors.length, 3);
    assert.equal(result.warnings[item.fact_id], undefined);
  } finally { globalThis.fetch = originalFetch; }
});
