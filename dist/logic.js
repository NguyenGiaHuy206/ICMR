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

export function addEntity(entities, fields) {
  const name = clean(fields.name);
  if (!name) throw new Error('Vui lòng nhập tên entity.');
  if (entities.some(entity => key(entity.name) === key(name))) throw new Error('Tên entity đã tồn tại.');
  const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entity';
  let id = base;
  for (let suffix = 2; entities.some(entity => entity.id === id); suffix++) id = `${base}-${suffix}`;
  return [...entities, { id, name, localName: clean(fields.localName), country: clean(fields.country), category: clean(fields.category), facts: [] }];
}

export function addFact(entities, fields) {
  const entity = entities.find(item => item.id === fields.entityId);
  if (!entity) throw new Error('Vui lòng chọn entity.');
  const statement = clean(fields.statement);
  if (!statement) throw new Error('Vui lòng nhập nội dung fact.');
  const aspect = clean(fields.aspect);
  if (!aspect) throw new Error('Vui lòng chọn aspect.');
  if (entity.facts.some(fact => key(fact.statement) === key(statement))) throw new Error('Fact này đã tồn tại trong entity.');
  let index = entity.facts.length + 1;
  let id = `${entity.id}-custom-${index}`;
  while (entity.facts.some(fact => fact.id === id)) id = `${entity.id}-custom-${++index}`;
  const fact = normalizeFact({ id, aspect, statement, short_answer: fields.shortAnswer, source: fields.source, status: 'mock' }, entity.name, entity.id, entity.facts.length);
  return entities.map(item => item.id === entity.id ? { ...item, facts: [...item.facts, fact] } : item);
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

function imageSubject(entity) {
  const category = key(entity.category).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  if (/am thuc|food|dish|cuisine/.test(category)) return 'Món ăn trong ảnh';
  if (/kien truc|cong trinh|architecture|heritage|di san/.test(category)) return 'Công trình trong ảnh';
  if (/dia diem|danh lam|place|location/.test(category)) return 'Địa điểm trong ảnh';
  if (/trang phuc|clothing|costume/.test(category)) return 'Trang phục trong ảnh';
  if (/do vat|vat pham|object|artifact/.test(category)) return 'Đồ vật trong ảnh';
  return 'Đối tượng trong ảnh';
}

function questionFor(entity, fact) {
  const subject = imageSubject(entity);
  const custom = clean(fact.question);
  const names = [entity.name, entity.localName].filter(Boolean);
  if (custom && /trong ảnh|in (?:the )?(?:image|photo|picture)/iu.test(custom) && !names.some(name => key(custom).includes(key(name)))) return custom;
  if (fact.raw) return `Theo knowledge base, ${fact.aspect_label.toLowerCase()} của ${subject.toLowerCase()} được mô tả như thế nào?`;
  if (questionTemplates[fact.aspect]) return questionTemplates[fact.aspect](subject);
  return `${fact.aspect_label} của ${subject.toLowerCase()} là gì?`;
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
        fact_id: fact.id, aspect: fact.aspect, aspect_label: fact.aspect_label, question: questionFor(entity, fact), requires_image: true,
        answer: fact.answer, evidence: fact.statement, source: fact.source, source_refs: fact.source_refs,
        kb_status: fact.status, review_status: 'draft', raw_answer: fact.raw,
        answer_origin: fact.answer_origin, confidence: fact.confidence
      };
      if (type === 'open') {
        if (fact.aspect === 'occasion' && imageSubject(entity) === 'Món ăn trong ảnh') {
          base.question = 'Món ăn trong ảnh là gì và thường xuất hiện trong dịp hoặc hoàn cảnh nào?';
          base.answer = `${entity.name}; ${fact.answer}`;
        }
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
  const header = ['type', 'entity_id', 'entity_name', 'fact_id', 'aspect', 'question', 'answer', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_letter', 'evidence', 'source', 'kb_status', 'answer_origin', 'confidence', 'review_status', 'requires_image'];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = questions.map(q => [q.type, q.entity_id, q.entity_name, q.fact_id, q.aspect, q.question, q.answer,
    ...(q.options || ['', '', '', '']), q.options ? 'ABCD'[q.correct_index] : '', q.evidence, q.source, q.kb_status, q.answer_origin, q.confidence, q.review_status, q.requires_image]);
  return '\uFEFF' + [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
}
