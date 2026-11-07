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
function containsGeographicHint(question) {
  const value = ascii(question);
  const geographicWords = /\b(?:country|countries|region|regional|province|provincial|state|city|village|district|island|peninsula|continent|north|south|east|west|central|southeast asia|asia|asian|africa|african|europe|european|america|american|diaspora)\b/i;
  const placeNames = /\b(?:vietnam|vietnamese|malaysia|malaysian|indonesia|indonesian|thailand|thai|cambodia|cambodian|laos|lao|myanmar|burmese|philippines|filipino|singapore|singaporean|brunei|timor|china|chinese|india|indian|japan|japanese|korea|korean|united states|usa|britain|british|france|french|australia|australian)\b/i;
  return geographicWords.test(value) || placeNames.test(value);
}
function validRequest(body) {
  return body && body.type === 'open' && Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 12 && body.items.every(item =>
    typeof item.task_id === 'string' && item.task_id.length <= 400 && ['easy', 'hard'].includes(item.difficulty) &&
    typeof item.entity_name === 'string' && item.entity_name.length <= 300 && Array.isArray(item.claims) &&
    item.claims.length >= (item.difficulty === 'hard' ? 2 : 1) && item.claims.length <= 8 &&
    (item.difficulty === 'easy' || (Number.isInteger(item.required_claim_count) && item.required_claim_count >= 2 && item.required_claim_count <= item.claims.length)) &&
    item.claims.every(claim => typeof claim.fact_id === 'string' && typeof claim.statement === 'string' && claim.statement.length > 0 && claim.statement.length <= 40000));
}
const schema = { type: 'object', additionalProperties: false, properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { task_id: { type: 'string' }, qa_pairs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { question: { type: 'string' }, golden_answer: { type: 'string' }, answer_type: { type: 'string' }, source_claim_ids: { type: 'array', items: { type: 'string' } }, evidence_excerpts: { type: 'array', items: { type: 'string' } } }, required: ['question', 'golden_answer', 'answer_type', 'source_claim_ids', 'evidence_excerpts'] } } }, required: ['task_id', 'qa_pairs'] } } }, required: ['items'] };
function instructionsFor() {
  return `You create English open-ended QA data for evaluating image-grounded knowledge retrieval.

Each item contains task_id, difficulty, entity information, and one or more claims from the same entity.

For EACH item, return exactly one QA pair:
1. Write question, golden_answer, source_claim_ids, and evidence_excerpts entirely in English.
2. Never reveal entity_name, its local name, or another unique proper name that identifies it in the question.
3. The question must require the image to identify the entity and then require retrieval from the KB.
4. Refer indirectly with phrases such as "this temple", "this monument", "this dish", "this garment", "this object", or "this place". Avoid the mechanical phrase "in the image".
5. Keep the question intentionally underspecified and concise. Do not copy answer-bearing clues from the claims into it.
6. Ground the golden answer only in the supplied claims. Do not add outside knowledge or explanations.
7. The QUESTION must not mention or hint at any country, nationality, demonym, region, province, city, compass region, continent, diaspora location, or phrases such as "country of origin" and "regional variation". If location is needed for the answer, ask indirectly, for example: "Where did this tradition originate?"
8. Remove geographic qualifiers even when they appear in the source claim. Never name a country, nationality, demonym, region, province, city, village, island, or direction in the question. If the answer is a place, ask with neutral wording such as "What origin is associated with this structure?" Do not ask "which country/region" or include the answer's place as a clue. The image must be the only clue used to identify the entity and its cultural setting.

DIFFICULTY RULES:
- EASY: Each easy task includes easy_aspect, easy_variant, and candidate claims from that aspect only. Create exactly one question for the task, grounded in exactly one supplied claim from that aspect. Choose a useful, self-contained detail and make the question different from other variants for the same entity and aspect. Do not synthesize multiple claims. The golden answer must be a minimal span, normally 1-5 words: a name, date, number, material, or short noun phrase. source_claim_ids must contain exactly one ID.
- HARD: First select exactly required_claim_count claims that have the strongest natural semantic relationship. Prefer claims that form one coherent relationship, process, comparison, cause, sequence, or description. Ignore unrelated candidate claims. Then write one question that can only be answered by combining all selected claims. source_claim_ids must contain exactly required_claim_count selected IDs.
- A HARD question must ask for a relationship, comparison, sequence, combined description, or grounded inference. Do not merely join two unrelated questions with "and".
- Keep the question focused even when required_claim_count is high. Do not turn it into a broad request for a comprehensive summary.
- evidence_excerpts must contain one short supporting excerpt for every selected source claim.

For multiple EASY tasks with the same entity and aspect, vary the question focus across the supplied claims/details and do not repeat a question. Use easy_variant as a hint to vary the focus, while remaining fully grounded in the claim selected for that answer.

Question style examples:
- EASY: "During which period was this temple built?" Answer: "Ninth century"
- EASY: "Who popularized this monument internationally?" Answer: "Stamford Raffles"
- HARD: "How did this monument's original construction and later restoration differ in technique?" The answer must combine evidence from construction and restoration claims.

Return only JSON matching the schema. Return exactly one qa_pairs entry per task_id.`;
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
    if (parsed.some(looksLikeQa) && requestedItems.length === 1) return [{ task_id: requestedItems[0].task_id, qa_pairs: parsed }];
    return parsed;
  }
  if (!parsed || typeof parsed !== 'object') return [];
  for (const key of ['items', 'results', 'tasks']) if (Array.isArray(parsed[key])) return normalizeModelItems(parsed[key], requestedItems);
  for (const key of ['qa_pairs', 'questions', 'qas']) if (Array.isArray(parsed[key]) && requestedItems.length === 1) return [{ task_id: parsed.task_id || requestedItems[0].task_id, qa_pairs: parsed[key] }];
  const keyed = Object.entries(parsed).filter(([, value]) => Array.isArray(value) || (value && typeof value === 'object'));
  return keyed.map(([task_id, value]) => Array.isArray(value) ? { task_id, qa_pairs: value } : { task_id: value.task_id || task_id, qa_pairs: value.qa_pairs || value.questions || value.qas }).filter(item => Array.isArray(item.qa_pairs));
}
function normalizePair(rawPair, source, index) {
  if (!rawPair || typeof rawPair !== 'object') return { reason: `QA ${index + 1} is not an object.` };
  const question = visibleQuestion(rawPair.question || rawPair.query || rawPair.prompt, source);
  const goldenAnswer = clean(rawPair.golden_answer || rawPair.goldenAnswer || rawPair.answer || rawPair.correct_answer || rawPair.correctAnswer);
  const allowedIds = new Set(source.claims.map(claim => claim.fact_id));
  const sourceIds = [...new Set((rawPair.source_claim_ids || rawPair.fact_ids || rawPair.claim_ids || []).map(clean).filter(id => allowedIds.has(id)))];
  const excerpts = (rawPair.evidence_excerpts || [rawPair.evidence_excerpt || rawPair.evidence || rawPair.supporting_text || rawPair.quote]).map(clean).filter(Boolean).slice(0, sourceIds.length || 1);
  if (!question) return { reason: `QA ${index + 1} is missing question.` };
  if (containsGeographicHint(question)) return { reason: 'Question contains a geographic or nationality hint; rewrite it more ambiguously.' };
  if (!goldenAnswer) return { reason: `QA ${index + 1} is missing golden_answer.` };
  if (source.difficulty === 'easy' && sourceIds.length !== 1) return { reason: 'Easy QA must cite exactly one supplied claim.' };
  if (source.difficulty === 'easy' && goldenAnswer.split(/\s+/).length > 8) return { reason: 'Easy golden_answer is longer than 8 words.' };
  if (source.difficulty === 'hard' && sourceIds.length !== source.required_claim_count) return { reason: `Hard QA must select exactly ${source.required_claim_count} related claims; it selected ${sourceIds.length}.` };
  if (excerpts.length < sourceIds.length) return { reason: 'Missing an evidence excerpt for one or more cited claims.' };
  return { value: { qa_id: `${source.task_id}:qa:${index + 1}`, difficulty: source.difficulty, question, golden_answer: goldenAnswer, answer_type: clean(rawPair.answer_type || rawPair.answerType || rawPair.type || 'other'), source_claim_ids: sourceIds, evidence_excerpts: excerpts, evidence_excerpt: excerpts.join(' | ') } };
}
async function generateQa(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'The request body is not valid JSON.' }, 400); }
  if (!validRequest(body)) return json({ error: 'The open-ended task list is invalid or exceeds the limit.' }, 400);
  const provider = clean(env.LLM_PROVIDER || 'vilao').toLowerCase();
  const items = body.items.map(item => ({
    task_id: item.task_id, difficulty: item.difficulty, entity_name: item.entity_name,
    entity_local_name: item.entity_local_name || '', entity_category: item.entity_category || '',
    easy_variant: item.difficulty === 'easy' ? item.easy_variant || 1 : undefined,
    easy_aspect: item.difficulty === 'easy' ? item.easy_aspect || '' : undefined,
    required_claim_count: item.difficulty === 'hard' ? item.required_claim_count : 1,
    claims: item.claims.map(claim => ({ fact_id: claim.fact_id, aspect: claim.aspect || 'other', aspect_id: claim.aspect_id || '', aspect_label: claim.aspect_label || claim.aspect || 'other', statement: claim.statement }))
  }));
  const qa_pairs = Object.fromEntries(items.map(item => [item.task_id, []]));
  const warnings = {};
  let model = '';
  let pending = items;
  let previousProblems = {};
  let previousDrafts = {};
  for (let attempt = 1; attempt <= 3 && pending.length; attempt++) {
    const repair = attempt === 1 ? '' : `\n\nREPAIR PASS ${attempt - 1}. Fix each validation error below. For geographic-hint errors, rewrite the question without any place, country, nationality, region, or directional wording. For claim-count errors, select exactly required_claim_count distinct IDs from that task's supplied claims and provide one matching evidence excerpt per selected claim. Do not repeat the previous invalid draft.\nValidation errors: ${JSON.stringify(previousProblems)}\nPrevious invalid drafts: ${JSON.stringify(previousDrafts)}\nRegenerate exactly one valid QA for each missing task.`;
    let output;
    try { output = await callModel(provider, env, instructionsFor() + repair, { qa_type: 'open', items: pending }); }
    catch (error) { return json({ error: error.message || 'Could not connect to the LLM.', retry_after_seconds: error.retryAfter || 0 }, error.status || 502); }
    model = output.model;
    let parsed;
    try { parsed = parseModelJson(output.text); }
    catch { previousProblems = Object.fromEntries(pending.map(item => [item.task_id, ['Response is not valid JSON.']])); continue; }
    const results = normalizeModelItems(parsed, pending);
    const resultById = new Map(results.map(result => [clean(result.task_id), result]));
    previousProblems = {};
    previousDrafts = {};
    const nextPending = [];
    for (const requested of pending) {
      const result = resultById.get(requested.task_id);
      const rejected = [];
      if (!result || !Array.isArray(result.qa_pairs)) rejected.push('No qa_pairs matched task_id.');
      else for (const [index, rawPair] of result.qa_pairs.entries()) {
        const pair = normalizePair(rawPair, requested, index);
        if (pair.value && !qa_pairs[requested.task_id].length) qa_pairs[requested.task_id].push(pair.value);
        else if (pair.reason) { rejected.push(pair.reason); previousDrafts[requested.task_id] = rawPair; }
      }
      if (!qa_pairs[requested.task_id].length) {
        previousProblems[requested.task_id] = rejected.length ? rejected : ['No valid QA returned.'];
        nextPending.push(requested);
      }
    }
    pending = nextPending;
  }
  for (const item of pending) warnings[item.task_id] = previousProblems[item.task_id] || ['Model did not complete this task.'];
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
