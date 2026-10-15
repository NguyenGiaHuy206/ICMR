const assets = __ASSETS__;
const contentTypes = { '/': 'text/html; charset=utf-8', '/index.html': 'text/html; charset=utf-8', '/app.js': 'text/javascript; charset=utf-8', '/logic.js': 'text/javascript; charset=utf-8', '/data.js': 'text/javascript; charset=utf-8', '/derive.js': 'text/javascript; charset=utf-8', '/styles.css': 'text/css; charset=utf-8', '/extras.css': 'text/css; charset=utf-8' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = value => String(value ?? '').trim();
const stripFence = value => clean(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
const escapeRe = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ascii = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
function englishSubject(category) {
  const value = ascii(category);
  if (/temple|monument|architecture|heritage|di san|cong trinh/.test(value)) return 'this structure';
  if (/food|dish|cuisine|am thuc/.test(value)) return 'this dish';
  if (/game|sport|tro choi|the thao/.test(value)) return 'this object';
  if (/clothing|costume|trang phuc/.test(value)) return 'this garment';
  if (/place|location|dia diem|danh lam/.test(value)) return 'this place';
  return 'this object';
}
function visibleQuestion(question, item) {
  let output = clean(question);
  const subject = englishSubject(item.entity_category);
  for (const name of [item.entity_name, item.entity_local_name].filter(Boolean)) output = output.replace(new RegExp(escapeRe(name), 'giu'), subject);
  output = output.replace(/\b(?:the )?(?:object|structure|building|temple|monument|dish|garment|place) (?:in|shown in) (?:the |this )?(?:image|photo|picture)\b/giu, subject);
  return output ? (/[?？]$/u.test(output) ? output : `${output}?`) : '';
}
function validRequest(body) {
  return body && ['mcq', 'open'].includes(body.type) && Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 12 && body.items.every(item =>
    typeof item.fact_id === 'string' && item.fact_id.length <= 160 && typeof item.entity_name === 'string' && item.entity_name.length <= 300 &&
    typeof item.statement === 'string' && item.statement.length > 0 && item.statement.length <= 40000 && Number(item.questions_per_fact) >= 1 && Number(item.questions_per_fact) <= 10);
}
const schema = { type: 'object', additionalProperties: false, properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { fact_id: { type: 'string' }, qa_pairs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { question: { type: 'string' }, golden_answer: { type: 'string' }, answer_type: { type: 'string' }, distractors: { type: 'array', items: { type: 'string' } }, evidence_excerpt: { type: 'string' } }, required: ['question', 'golden_answer', 'answer_type', 'distractors', 'evidence_excerpt'] } } }, required: ['fact_id', 'qa_pairs'] } } }, required: ['items'] };
function instructionsFor(type) {
  const choiceRule = type === 'mcq' ? 'Every QA must contain exactly three distractors.' : 'This is open-ended QA, so distractors must always be an empty array.';
  return `You create English QA data for evaluating image-grounded knowledge retrieval.

Each item contains entity_name, entity_category, fact_id, aspect, statement, and questions_per_fact. The statement may be a long passage containing many events, dates, people, and relations.

For EACH fact, follow this order:
1. Read entity_name and the entire statement. Split the passage into independently verifiable atomic claims.
2. Select at most questions_per_fact distinct claims. Do not create duplicate questions.
3. Write the question, golden_answer, distractors, and evidence_excerpt entirely in English, even when the KB text is in another language.
4. The question must require the image to identify the entity and then require retrieval from the KB to answer. Never reveal entity_name, its local name, or another unique proper name that identifies it.
5. Refer to the entity indirectly with short phrases such as “this temple”, “this monument”, “this dish”, “this garment”, “this object”, “this place”, or “the structure shown above”. Avoid the mechanical phrase “in the image”.
6. Keep the question intentionally underspecified and concise. Ask for only one fact. Do not copy supporting clues, explanatory clauses, dates, names, locations, titles, or answer-bearing details from the statement into the question.
7. Create a concise but complete golden_answer grounded only in statement. Do not use outside knowledge for the correct answer. evidence_excerpt must be a short passage from statement that verifies the answer.
8. ${choiceRule} Create distractors only after question and golden_answer are fixed.

Question style examples:
- Good: “During which period was this temple built?”
- Good: “Under whose rule was this temple constructed?”
- Good: “When was this monument rediscovered?”
- Good: “What material is this object traditionally made from?”
- Bad: “Which ninth-century temple completed by Samaratungga in 825 is shown?”
- Bad: “In 1814, who was informed about a large monument near Bumisegoro?”
- Bad: “What title did Guinness World Records give this structure in June 2012?”
The bad questions leak retrieval clues. Rewrite them as “Who brought this monument to worldwide attention?” or “What world record has this temple held?”

Distractor rules:
- Base them on question, entity_name, golden_answer, and statement context.
- Every option must directly answer the question with the same semantic type, specificity, and format as golden_answer.
- Each option must be plausible for a similar entity but false for entity_name.
- Never cross aspects. A year question gets years; a person question gets people; a material question gets materials; a place question gets places.
- Do not repeat, paraphrase, partially contain, or imply golden_answer.

Return only JSON matching the schema. Each item may contain at most questions_per_fact qa_pairs.`;
}
async function callModel(provider, env, instructions, input) {
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) throw Object.assign(new Error('Chưa cấu hình OPENAI_API_KEY.'), { status: 503 });
    const model = env.OPENAI_MODEL || 'gpt-4o-mini';
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify({ model, instructions, input: JSON.stringify(input), text: { format: { type: 'json_schema', name: 'qa_generation', strict: true, schema } }, max_output_tokens: 12000 }) });
    if (!response.ok) throw new Error(`OpenAI trả về HTTP ${response.status}.`);
    const data = await response.json();
    return { model, text: data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text };
  }
  if (provider === 'vilao') {
    if (!env.VILAO_API_KEY) throw Object.assign(new Error('Chưa cấu hình VILAO_API_KEY.'), { status: 503 });
    const model = env.VILAO_MODEL || 'chib/gemini-3.8-flash';
    const base = String(env.VILAO_BASE_URL || 'https://api.vilao.ai/v1').replace(/\/$/, '');
    const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.VILAO_API_KEY}` }, body: JSON.stringify({ model, temperature: 0.35, max_tokens: 12000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(input) }] }) });
    if (!response.ok) {
      const detail = clean(await response.text()).slice(0, 300);
      const error = new Error(`Vilao trả về HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      error.status = response.status;
      error.retryAfter = Number(response.headers.get('retry-after')) || (response.status === 429 ? 10 : 0);
      throw error;
    }
    const data = await response.json();
    return { model, text: data.choices?.[0]?.message?.content };
  }
  const model = env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';
  const base = String(env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false, format: schema, options: { temperature: 0.35, top_p: 0.9, num_ctx: 32768 }, messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(input) }] }) });
  if (!response.ok) throw new Error(`Ollama trả về HTTP ${response.status}.`);
  const data = await response.json();
  return { model, text: data.message?.content };
}
function parseModelJson(value) {
  const text = stripFence(value);
  try { return JSON.parse(text); } catch {}
  const starts = [text.indexOf('{'), text.indexOf('[')].filter(index => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === open) depth++;
      else if (character === close && --depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  throw new Error('Invalid JSON');
}
function looksLikeQa(value) {
  return value && typeof value === 'object' && ('question' in value || 'golden_answer' in value || 'answer' in value);
}
function normalizeModelItems(parsed, requestedItems) {
  if (Array.isArray(parsed)) {
    if (parsed.some(looksLikeQa) && requestedItems.length === 1) return [{ fact_id: requestedItems[0].fact_id, qa_pairs: parsed }];
    return parsed;
  }
  if (!parsed || typeof parsed !== 'object') return [];
  for (const key of ['items', 'results', 'facts']) if (Array.isArray(parsed[key])) return normalizeModelItems(parsed[key], requestedItems);
  for (const key of ['qa_pairs', 'questions', 'qas']) if (Array.isArray(parsed[key]) && requestedItems.length === 1) return [{ fact_id: parsed.fact_id || requestedItems[0].fact_id, qa_pairs: parsed[key] }];
  const keyed = Object.entries(parsed).filter(([, value]) => Array.isArray(value) || (value && typeof value === 'object'));
  return keyed.map(([fact_id, value]) => Array.isArray(value) ? { fact_id, qa_pairs: value } : { fact_id: value.fact_id || fact_id, qa_pairs: value.qa_pairs || value.questions || value.qas }).filter(item => Array.isArray(item.qa_pairs));
}
function normalizePair(rawPair, source, type, index) {
  if (!rawPair || typeof rawPair !== 'object') return { reason: `QA ${index + 1} không phải object.` };
  const question = visibleQuestion(rawPair.question || rawPair.query || rawPair.prompt, source);
  const goldenAnswer = clean(rawPair.golden_answer || rawPair.goldenAnswer || rawPair.answer || rawPair.correct_answer || rawPair.correctAnswer);
  let rawDistractors = rawPair.distractors || rawPair.incorrect_answers || rawPair.incorrectAnswers;
  if (!Array.isArray(rawDistractors) && Array.isArray(rawPair.options || rawPair.choices)) {
    rawDistractors = (rawPair.options || rawPair.choices).map(option => typeof option === 'object' ? (option.text || option.value || option.label) : option).filter(option => clean(option) !== goldenAnswer);
  }
  const distractors = type === 'mcq' ? [...new Set((Array.isArray(rawDistractors) ? rawDistractors : []).map(value => typeof value === 'object' ? (value.text || value.value || value.label) : value).map(clean).filter(value => value && value !== goldenAnswer))].slice(0, 3) : [];
  if (!question) return { reason: `QA ${index + 1} thiếu question.` };
  if (!goldenAnswer) return { reason: `QA ${index + 1} thiếu golden_answer.` };
  if (type === 'mcq' && distractors.length !== 3) return { reason: `QA ${index + 1} chỉ có ${distractors.length}/3 distractor khác nhau.` };
  return { value: { qa_id: `${source.fact_id}:qa:${index + 1}`, question, golden_answer: goldenAnswer, answer_type: clean(rawPair.answer_type || rawPair.answerType || rawPair.type || 'other'), distractors, evidence_excerpt: clean(rawPair.evidence_excerpt || rawPair.evidence || rawPair.supporting_text || rawPair.quote).slice(0, 1000) } };
}
async function generateQa(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Dữ liệu gửi lên không hợp lệ.' }, 400); }
  if (!validRequest(body)) return json({ error: 'Danh sách fact không hợp lệ, quá dài hoặc vượt giới hạn.' }, 400);
  const provider = clean(env.LLM_PROVIDER || 'vilao').toLowerCase();
  const items = body.items.map(item => ({ fact_id: item.fact_id, entity_name: item.entity_name, entity_local_name: item.entity_local_name || '', entity_category: item.entity_category || '', aspect: item.aspect || 'other', aspect_id: item.aspect_id || '', aspect_label: item.aspect_label || item.aspect || 'other', statement: item.statement, questions_per_fact: Math.max(1, Math.min(10, Number(item.questions_per_fact) || 1)) }));
  const byId = new Map(items.map(item => [item.fact_id, item]));
  const qa_pairs = Object.fromEntries(items.map(item => [item.fact_id, []]));
  const warnings = {};
  let model = '';
  let pending = items;
  let previousProblems = {};
  for (let attempt = 1; attempt <= 3 && pending.length; attempt++) {
    const repair = attempt === 1 ? '' : `

REPAIR PASS ${attempt - 1}. The previous response was rejected for these exact reasons:
${JSON.stringify(previousProblems)}
Regenerate only the requested missing QA. Every MCQ must have exactly three non-empty, unique distractors that differ from the golden answer. Check the JSON yourself before returning it.`;
    let output;
    try { output = await callModel(provider, env, instructionsFor(body.type) + repair, { qa_type: body.type, items: pending }); }
    catch (error) { return json({ error: error.message || 'Không kết nối được LLM.', retry_after_seconds: error.retryAfter || 0 }, error.status || 502); }
    model = output.model;
    let parsed;
    try { parsed = parseModelJson(output.text); }
    catch {
      previousProblems = Object.fromEntries(pending.map(item => [item.fact_id, ['Phản hồi không phải JSON hợp lệ.']]));
      continue;
    }
    const results = normalizeModelItems(parsed, pending);
    const resultById = new Map(results.map(result => [clean(result.fact_id), result]));
    previousProblems = {};
    const nextPending = [];
    for (const requested of pending) {
      const result = resultById.get(requested.fact_id);
      const accepted = [];
      const rejected = [];
      if (!result || !Array.isArray(result.qa_pairs)) rejected.push('Không tìm thấy qa_pairs khớp fact_id.');
      else for (const [index, rawPair] of result.qa_pairs.entries()) {
        const pair = normalizePair(rawPair, requested, body.type, qa_pairs[requested.fact_id].length + index);
        if (pair.value) accepted.push(pair.value);
        else rejected.push(pair.reason);
      }
      for (const pair of accepted) {
        const signature = ascii(pair.question) + '|' + ascii(pair.golden_answer);
        if (!qa_pairs[requested.fact_id].some(existing => ascii(existing.question) + '|' + ascii(existing.golden_answer) === signature)) qa_pairs[requested.fact_id].push(pair);
      }
      qa_pairs[requested.fact_id] = qa_pairs[requested.fact_id].slice(0, requested.questions_per_fact);
      const missing = requested.questions_per_fact - qa_pairs[requested.fact_id].length;
      if (missing > 0) {
        previousProblems[requested.fact_id] = [...rejected, `Còn thiếu ${missing} QA hợp lệ.`];
        nextPending.push({ ...requested, questions_per_fact: missing });
      }
    }
    pending = nextPending;
  }
  for (const item of pending) warnings[item.fact_id] = previousProblems[item.fact_id] || ['Model không hoàn tất QA sau các lượt tự sửa.'];
  return json({ qa_pairs, warnings, model, provider });
}
async function llmStatus(env) {
  const provider = clean(env.LLM_PROVIDER || 'vilao').toLowerCase();
  if (provider === 'vilao') return json({ available: !!env.VILAO_API_KEY, provider, model: env.VILAO_MODEL || 'chib/gemini-3.8-flash', reason: env.VILAO_API_KEY ? null : 'Chưa cấu hình VILAO_API_KEY' });
  if (provider === 'openai') return json({ available: !!env.OPENAI_API_KEY, provider, model: env.OPENAI_MODEL || 'gpt-4o-mini', reason: env.OPENAI_API_KEY ? null : 'Chưa cấu hình OPENAI_API_KEY' });
  const model = env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';
  try { const base = String(env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, ''); const response = await fetch(`${base}/api/tags`); const data = response.ok ? await response.json() : {}; const available = (data.models || []).some(item => item.name === model || item.model === model || item.name?.startsWith(`${model}:`)); return json({ available, provider, model, reason: available ? null : `Chưa tải model ${model}` }); }
  catch { return json({ available: false, provider, model, reason: 'Ollama chưa chạy' }); }
}
export default { async fetch(request, env = {}) {
  const path = new URL(request.url).pathname;
  if (path === '/api/llm-status' && request.method === 'GET') return llmStatus(env);
  if ((path === '/api/generate-qa' || path === '/api/distractors') && request.method === 'POST') return generateQa(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const assetPath = path === '/' ? '/index.html' : path; const asset = assets[assetPath];
  if (asset === undefined) return new Response('Not found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : asset, { headers: { 'content-type': contentTypes[path] || contentTypes[assetPath] || 'text/plain; charset=utf-8', 'cache-control': 'no-store, max-age=0' } });
} };
