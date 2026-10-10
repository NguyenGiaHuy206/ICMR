import { aspectLabels, questionTemplates } from './data.js';
import { deriveAnswer } from './derive.js';

const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLocaleLowerCase('vi');
const goodStatuses = new Set(['mock', 'approved', 'adjudicated', 'accepted', 'verified']);

export function normalizeKnowledgeBase(input) {
  const rows = Array.isArray(input) ? input : input?.entities;
  if (!Array.isArray(rows)) throw new Error('JSON cần là một mảng entities hoặc có trường "entities".');
  if (!rows.length) throw new Error('Không tìm thấy entity nào trong dữ liệu.');

  const isClaimList = rows.some(row => row.claim_text || row.claim?.claim_text);
  const entities = isClaimList ? groupClaims(rows) : rows.map((entity, entityIndex) => {
    const name = clean(entity.name || entity.entity_name);
    if (!name) throw new Error(`Entity thứ ${entityIndex + 1} thiếu tên.`);
    const id = clean(entity.id || entity.entity_id || `entity-${entityIndex + 1}`);
    const rawFacts = entity.facts || entity.claims || [];
    if (!Array.isArray(rawFacts)) throw new Error(`${name}: facts/claims phải là mảng.`);
    return {
      id, name, localName: clean(entity.localName || entity.local_name),
      country: clean(entity.country || entity.country_id), category: clean(entity.category || entity.category_id),
      facts: rawFacts.map((fact, index) => normalizeFact(fact, name, id, index))
    };
  });
  const ids = entities.map(entity => entity.id);
  if (new Set(ids).size !== ids.length) throw new Error('ID entity bị trùng.');
  if (!entities.some(entity => entity.facts.length)) throw new Error('Không tìm thấy facts hoặc claims trong KB.');
  return entities;
}

function groupClaims(rows) {
  const map = new Map();
  rows.forEach((item, index) => {
    const claim = item.claim || item;
    const id = clean(claim.entity_id || item.entity_id || item.entity?.entity_id);
    const name = clean(claim.entity_name || item.entity_name || item.entity?.name || id);
    if (!id) throw new Error(`Claim dòng ${index + 1} thiếu entity_id.`);
    if (!map.has(id)) map.set(id, { id, name, localName: '', country: '', category: '', facts: [] });
    map.get(id).facts.push(normalizeFact(claim, name, id, map.get(id).facts.length));
  });
  return [...map.values()];
}

function normalizeFact(fact, entityName, entityId, index) {
  if (typeof fact === 'string') fact = { statement: fact };
  if (!fact || typeof fact !== 'object') throw new Error(`${entityId}: fact ${index + 1} không hợp lệ.`);
  const statement = clean(fact.statement || fact.claim_text || fact.text);
  const aspect = clean(fact.aspect || fact.aspect_id || 'other');
  const providedAnswer = clean(fact.short_answer || fact.value || (fact.raw ? '' : fact.answer));
  const derived = providedAnswer
    ? { answer: providedAnswer, answer_origin: fact.answer_origin || 'provided', confidence: fact.confidence || 'high' }
    : deriveAnswer(statement, aspect);
  const answer = derived.answer;
  if (!answer) throw new Error(`${entityId}: fact ${index + 1} thiếu nội dung.`);
  const sources = fact.source_refs || fact.sources || [];
  const source = clean(fact.source || fact.source_url || (Array.isArray(sources) ? sources.map(s => s.title || s.source_url || s.source_id).join('; ') : ''));
  return {
    id: clean(fact.id || fact.claim_id || `${entityId}-${index + 1}`), aspect,
    aspect_label: clean(fact.aspect_label || fact.display_name || aspectLabels[aspect] || aspect),
    answer, statement: statement || answer, question: clean(fact.question), source,
    answer_origin: derived.answer_origin, confidence: derived.confidence,
    source_refs: Array.isArray(sources) ? sources.map(s => ({ source_id: clean(s.source_id), title: clean(s.title), url: clean(s.url || s.source_url), locator: clean(s.locator || s.supporting_locator), evidence_id: clean(s.evidence_id) })) : [],
    status: clean(fact.status || fact.global_status || 'unreviewed').toLowerCase(),
    raw: derived.answer_origin === 'fallback'
  };
}

function random(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
}

function shuffle(items, rng) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function questionFor(entity, fact) {
  if (fact.question) return fact.question;
  if (fact.raw) return /[à-ỹ]/iu.test(fact.statement)
    ? `Theo knowledge base, ${fact.aspect_label} của ${entity.name} được mô tả như thế nào?`
    : `What does the knowledge base state about ${fact.aspect_label.toLowerCase()} of ${entity.name}?`;
  if (questionTemplates[fact.aspect]) return questionTemplates[fact.aspect](entity.name);
  return `Theo knowledge base, ${fact.aspect_label} của ${entity.name} được mô tả như thế nào?`;
}

export function generateQuestions({ entities, type, selectedIds, perEntity = 2, seed = 2027, includeUnreviewed = false }) {
  if (!['mcq', 'open'].includes(type)) throw new Error('Loại câu hỏi không hợp lệ.');
  const rng = random(seed);
  const selected = new Set(selectedIds);
  const count = Math.max(1, Math.min(20, Number(perEntity) || 1));
  const usable = fact => goodStatuses.has(fact.status) || (includeUnreviewed && ['pending', 'in_progress', 'not_reviewed'].includes(fact.status));
  const approvedFacts = entities.flatMap(entity => entity.facts.filter(fact => usable(fact) && !fact.raw).map(fact => ({ entity, fact })));
  const questions = [];
  const skipped = [];
  for (const entity of entities.filter(item => selected.has(item.id))) {
    const available = entity.facts.filter(usable);
    const fallbackCount = available.filter(fact => fact.raw).length;
    if (type === 'mcq' && fallbackCount) skipped.push(`${entity.name}: ${fallbackCount} claim chưa rút được đáp án ngắn; cần biên tập hoặc bổ sung short_answer.`);
    const facts = shuffle(available.filter(fact => type !== 'mcq' || !fact.raw), rng).slice(0, count);
    if (!facts.length) skipped.push(`${entity.name}: chưa có fact được duyệt hoặc dữ liệu mẫu.`);
    for (const fact of facts) {
      const base = {
        id: `${type}-${fact.id}`, type, entity_id: entity.id, entity_name: entity.name,
        fact_id: fact.id, aspect: fact.aspect, aspect_label: fact.aspect_label, question: questionFor(entity, fact),
        answer: fact.answer, evidence: fact.statement, source: fact.source, source_refs: fact.source_refs,
        kb_status: fact.status, review_status: 'draft', raw_answer: fact.raw,
        answer_origin: fact.answer_origin, confidence: fact.confidence
      };
      if (type === 'open') {
        questions.push(base);
        continue;
      }
      const correctOption = fact.answer;
      const alternatives = [...new Map(approvedFacts
        .filter(item => item.entity.id !== entity.id && item.fact.aspect === fact.aspect && key(item.fact.answer) !== key(fact.answer))
        .map(item => [key(item.fact.answer), item.fact.answer])).values()]
        .filter(value => key(value) !== key(correctOption));
      if (alternatives.length < 3) {
        skipped.push(`${entity.name} · ${fact.aspect_label}: thiếu 3 phương án nhiễu cùng aspect.`);
        continue;
      }
      const options = shuffle([correctOption, ...shuffle(alternatives, rng).slice(0, 3)], rng);
      questions.push({ ...base, options, correct_index: options.findIndex(option => key(option) === key(correctOption)) });
    }
  }
  return { questions, skipped };
}

export function toCsv(questions) {
  const header = ['type', 'entity_id', 'entity_name', 'fact_id', 'aspect', 'question', 'answer', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_letter', 'evidence', 'source', 'kb_status', 'answer_origin', 'confidence', 'review_status'];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = questions.map(q => [q.type, q.entity_id, q.entity_name, q.fact_id, q.aspect, q.question, q.answer,
    ...(q.options || ['', '', '', '']), q.options ? 'ABCD'[q.correct_index] : '', q.evidence, q.source, q.kb_status, q.answer_origin, q.confidence, q.review_status]);
  return '\uFEFF' + [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
}
