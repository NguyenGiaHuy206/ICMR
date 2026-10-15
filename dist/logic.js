import { aspectLabels, questionTemplates } from './data.js';
import { deriveAnswer } from './derive.js';

const clean = value => String(value ?? '').trim();
const cleanCandidate = value => clean(value).replace(/^\s*(?:\{?[a-h]\}?|\(?[1-8]\)?)[.):\-]\s*/iu, '').replace(/[.!?]+$/u, '').trim();
const key = value => clean(value).toLocaleLowerCase('vi');
const compareKey = value => key(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
const sameOrContained = (left, right) => {
  const a = compareKey(left); const b = compareKey(right);
  return !!a && !!b && (a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b)));
};
const ingredientTerms = /\b(gao|nep|bot|thit|tom|ca|trung|dau|duong|muoi|tieu|mam|sua|dua|chuoi|la|rau|cu|qua|nam|pho mai|bo|dau an|nuoc|gia vi|ngu coc|khoai|san|ngo|bap|me|mat ong|vanilla|socola|ca cao|hanh|toi|gung|ot)\b/;
const nonIngredientTerms = /\b(da cau|bong da|keo co|tro choi|mon the thao|le hoi|tet|ngay le|mien bac|mien trung|mien nam|tinh|thanh pho|hinh vuong|hinh tron|tam giac|chu nhat)\b/;
const materialTerms = /\b(go|tre|nua|may|vai|lua|len|bong|long|da|cao su|nhua|kim loai|dong|sat|thep|bac|vang|giay|dat|gom|su|thuy tinh|day|dem xop|xop|cot|soi)\b/;

export function fitsAspect(aspect, value) {
  const group = clean(aspect).split('.').at(-1);
  const normalized = compareKey(value);
  if (!normalized || normalized.length > 300) return false;
  if (group !== 'ingredients') return true;
  if (nonIngredientTerms.test(normalized)) return false;
  return ingredientTerms.test(normalized) || /[,;+&]/.test(value) || /\s(?:va|hoac)\s/.test(normalized);
}

function fitsAnswerType(answerType, aspect, value) {
  const normalized = compareKey(value);
  if (answerType === 'food_ingredients') return fitsAspect('ingredients', value);
  if (answerType === 'materials') return materialTerms.test(normalized) && !/\b(tet|le hoi|tro choi|mien bac|mien nam|thanh pho)\b/.test(normalized);
  if (answerType === 'shape') return /\b(hinh|tron|vuong|tam giac|chu nhat|bau duc|tru|dai|det|cong|khuyet)\b/.test(normalized);
  if (answerType === 'occasion') return /\b(tet|le hoi|dip|ngay|mua|su kien|dam cuoi|gio to|xuan|thu|dong|he)\b/.test(normalized);
  if (answerType === 'place') return /\b(viet nam|trung quoc|lao|campuchia|hue|ha noi|sai gon|bac|trung|nam|mien|vung|tinh|thanh pho)\b/.test(normalized);
  return fitsAspect(aspect, value);
}
const goodStatuses = new Set(['mock', 'approved', 'adjudicated', 'accepted', 'verified', 'machine_accepted']);
const categoryKey = entity => compareKey(entity.category);
const sharesCategory = (left, right) => categoryKey(left) && categoryKey(left) === categoryKey(right);

export function normalizeKnowledgeBase(input) {
  const rows = Array.isArray(input) ? input : Array.isArray(input?.entities) ? input.entities : input?.aspects && input?.entity_name ? [input] : null;
  if (!Array.isArray(rows)) throw new Error('JSON cần là một entity có aspects[], một mảng entity, hoặc có trường entities[].');
  if (!rows.length) throw new Error('Không tìm thấy entity nào trong dữ liệu.');

  const isClaimList = rows.some(row => row.claim_text || row.claim?.claim_text);
  const entities = isClaimList ? groupClaims(rows) : rows.map((entity, entityIndex) => {
    const name = clean(entity.name || entity.entity_name);
    if (!name) throw new Error(`Entity thứ ${entityIndex + 1} thiếu tên.`);
    const id = clean(entity.id || entity.entity_id || `entity-${entityIndex + 1}`);
    const rawFacts = entity.aspects || entity.facts || entity.claims || [];
    if (!Array.isArray(rawFacts)) throw new Error(`${name}: aspects/facts/claims phải là mảng.`);
    return {
      id, name, localName: clean(entity.localName || entity.local_name),
      country: clean(entity.country || entity.country_id), category: clean(entity.category || entity.category_id),
      schema_version: clean(entity.schema_version), synthetic: Boolean(entity.synthetic),
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
    const category = clean(claim.category || claim.category_id || item.category || item.category_id || item.entity?.category || item.entity?.category_id);
    const country = clean(claim.country || claim.country_id || item.country || item.country_id || item.entity?.country || item.entity?.country_id);
    if (!map.has(id)) map.set(id, { id, name, localName: '', country, category, facts: [] });
    const entity = map.get(id);
    if (!entity.category && category) entity.category = category;
    if (!entity.country && country) entity.country = country;
    entity.facts.push(normalizeFact(claim, name, id, entity.facts.length));
  });
  return [...map.values()];
}

function normalizeFact(fact, entityName, entityId, index) {
  if (typeof fact === 'string') fact = { statement: fact };
  if (!fact || typeof fact !== 'object') throw new Error(`${entityId}: fact ${index + 1} không hợp lệ.`);
  const statement = clean(fact.statement || fact.claim || fact.claim_text || fact.text);
  const aspectId = clean(fact.aspect_id || (fact.aspect_name ? fact.id : ''));
  const aspect = clean(fact.aspect || fact.aspect_name || fact.aspect_id || 'other');
  const providedAnswer = clean(fact.short_answer || fact.value || (fact.raw ? '' : fact.answer));
  const derived = providedAnswer
    ? { answer: providedAnswer, answer_origin: fact.answer_origin || 'provided', confidence: fact.confidence || 'high' }
    : deriveAnswer(statement, aspect);
  const answer = derived.answer;
  if (!answer) throw new Error(`${entityId}: fact ${index + 1} thiếu nội dung.`);
  const sources = fact.source_refs || fact.sources || [];
  const source = clean(fact.source || fact.source_url || (Array.isArray(sources) ? sources.map(s => s.title || s.source_url || s.source_id).join('; ') : ''));
  return {
    id: clean(fact.claim_id || fact.id || `${entityId}-${index + 1}`), aspect, aspect_id: aspectId,
    aspect_label: clean(fact.aspect_label || fact.aspect_name || fact.display_name || aspectLabels[aspect] || aspect),
    answer, statement: statement || answer, question: clean(fact.question), source,
    answer_origin: derived.answer_origin, confidence: derived.confidence,
    source_refs: Array.isArray(sources) ? sources.map(s => ({ source_id: clean(s.source_id), title: clean(s.title), url: clean(s.url || s.source_url), locator: clean(s.locator || s.supporting_locator), evidence_id: clean(s.evidence_id) })) : [],
    verification: fact.verification && typeof fact.verification === 'object' ? { status: clean(fact.verification.status), provider: clean(fact.verification.provider), model: clean(fact.verification.model) } : null,
    status: clean(fact.status || fact.global_status || fact.verification?.status || 'unreviewed').toLowerCase(),
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

export function updateFact(entities, fields) {
  const entity = entities.find(item => item.id === fields.entityId);
  const existing = entity?.facts.find(item => item.id === fields.factId);
  if (!entity || !existing) throw new Error('Không tìm thấy fact cần sửa.');
  const statement = clean(fields.statement);
  const aspect = clean(fields.aspect);
  if (!statement || !aspect) throw new Error('Fact cần có aspect và nội dung.');
  if (entity.facts.some(fact => fact.id !== existing.id && key(fact.statement) === key(statement))) throw new Error('Fact này đã tồn tại trong entity.');
  const updated = normalizeFact({ id: existing.id, aspect_id: existing.aspect_id, aspect, statement, short_answer: fields.shortAnswer, source: fields.source, status: existing.status, verification: existing.verification, question: existing.question }, entity.name, entity.id, entity.facts.indexOf(existing));
  return entities.map(item => item.id === entity.id ? { ...item, facts: item.facts.map(fact => fact.id === existing.id ? updated : fact) } : item);
}

export function removeFact(entities, entityId, factId) {
  const entity = entities.find(item => item.id === entityId);
  if (!entity?.facts.some(fact => fact.id === factId)) throw new Error('Không tìm thấy fact cần xóa.');
  return entities.map(item => item.id === entityId ? { ...item, facts: item.facts.filter(fact => fact.id !== factId) } : item);
}

function random(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
}

function stableSeed(seed, ...parts) {
  let value = (Number(seed) || 1) >>> 0;
  for (const char of parts.join('|')) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value || 1;
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

function questionForAnswerType(entity, answerType, fact) {
  const subject = imageSubject(entity);
  const lowerSubject = subject.toLowerCase();
  if (answerType === 'materials') return `${subject} được làm từ những vật liệu nào?`;
  if (answerType === 'food_ingredients') return `Món ăn trong ảnh được làm từ những nguyên liệu nào?`;
  if (answerType === 'place') return `${subject} có nguồn gốc hoặc phổ biến ở đâu?`;
  if (answerType === 'occasion') return `${subject} thường xuất hiện trong dịp hoặc hoàn cảnh nào?`;
  if (answerType === 'shape') return `${subject} có hình dạng như thế nào?`;
  if (answerType === 'meaning') return `${subject} mang ý nghĩa hoặc biểu tượng gì?`;
  if (answerType === 'activity_rules') return `Theo knowledge base, ${lowerSubject} được sử dụng hoặc chơi như thế nào?`;
  if (answerType === 'identity') return `${subject} là gì?`;
  return questionFor(entity, fact);
}

function localFallbackDistractors(fact, answerType, used, count) {
  const aspect = clean(fact.aspect).toLocaleLowerCase('vi');
  const pool = answerType === 'place' || /origin|nguồn gốc|địa điểm|region|place/.test(aspect)
    ? ['miền Bắc', 'miền Nam', 'Tây Nguyên', 'Đồng bằng sông Cửu Long', 'Hà Nội', 'Huế', 'Trung Quốc']
    : answerType === 'occasion' || /occasion|dịp|hoàn cảnh|sử dụng/.test(aspect)
      ? ['trong lễ hội truyền thống', 'vào dịp Tết Nguyên đán', 'trong hoạt động biểu diễn', 'trong sinh hoạt hằng ngày', 'trong các buổi học']
      : answerType === 'shape' || /shape|hình dáng/.test(aspect)
        ? ['hình tròn', 'hình vuông', 'hình tam giác', 'hình chữ nhật', 'hình bầu dục']
        : answerType === 'food_ingredients'
          ? ['gạo nếp và đậu xanh', 'bột mì và trứng', 'khoai môn và nước cốt dừa', 'thịt và nấm', 'đậu đỏ và đường']
          : ['tre và dây', 'vải và bông', 'gỗ và kim loại', 'cao su và nhựa', 'giấy và bìa'];
  return pool.filter(value => !used.some(item => sameOrContained(value, item))).slice(0, count);
}

export function generateQuestions({ entities, type, selectedIds, perEntity = 3, perFact = 3, seed = 2027, includeUnreviewed = false, llmQaPairs = {}, llmErrors = {} }) {
  if (!['mcq', 'open'].includes(type)) throw new Error('Loại câu hỏi không hợp lệ.');
  const rng = random(seed);
  const selected = new Set(selectedIds);
  const factCount = Math.max(1, Math.min(20, Number(perEntity) || 1));
  const questionCount = Math.max(1, Math.min(10, Number(perFact) || 1));
  const usable = fact => goodStatuses.has(fact.status) || (includeUnreviewed && ['pending', 'in_progress', 'not_reviewed'].includes(fact.status));
  const questions = [];
  const skipped = [];
  const needsLlm = [];
  const llmItems = [];
  for (const entity of entities.filter(item => selected.has(item.id))) {
    const available = entity.facts.filter(usable);
    const facts = shuffle(available, random(stableSeed(seed, 'facts', entity.id))).slice(0, factCount);
    if (!facts.length) skipped.push(`${entity.name}: chưa có fact được duyệt hoặc dữ liệu mẫu.`);
    for (const fact of facts) {
      llmItems.push({
        fact_id: fact.id, entity_name: entity.name, entity_category: entity.category, entity_local_name: entity.localName,
        aspect: fact.aspect, aspect_id: fact.aspect_id, aspect_label: fact.aspect_label, statement: fact.statement, questions_per_fact: questionCount
      });
      const pairs = Array.isArray(llmQaPairs[fact.id]) ? llmQaPairs[fact.id].slice(0, questionCount) : [];
      if (!pairs.length && (Object.keys(llmQaPairs).length || Object.keys(llmErrors).length)) skipped.push(`${entity.name} · ${fact.aspect_label}: ${llmErrors[fact.id] || 'model chưa tạo được QA hợp lệ.'}`);
      pairs.forEach((pair, index) => {
        const answer = clean(pair.golden_answer);
        const question = clean(pair.question);
        if (!answer || !question) return;
        const base = {
          id: `${type}-${fact.id}-${index + 1}`, qa_id: clean(pair.qa_id) || `${fact.id}:qa:${index + 1}`,
          gold_answer_id: `${fact.id}:gold:${index + 1}`, type, entity_id: entity.id, entity_name: entity.name,
          fact_id: fact.id, evidence_fact_id: fact.id, aspect: fact.aspect, aspect_id: fact.aspect_id, aspect_label: fact.aspect_label,
          question, answer, answer_type: clean(pair.answer_type || 'other'), evidence: clean(pair.evidence_excerpt),
          source: fact.source, source_refs: fact.source_refs, kb_status: fact.status, review_status: 'draft',
          answer_origin: 'llm_grounded', confidence: 'review_required', requires_image: true
        };
        if (type === 'open') { questions.push(base); return; }
        const distractors = [...new Map((pair.distractors || []).map(cleanCandidate).filter(Boolean)
          .filter(value => !sameOrContained(value, answer)).map(value => [compareKey(value), value])).values()].slice(0, 3);
        if (distractors.length !== 3) { skipped.push(`${entity.name} · ${fact.aspect_label} · QA ${index + 1}: model không trả đủ 3 phương án nhiễu.`); return; }
        const mixed = shuffle([{ value: answer, source: 'correct' }, ...distractors.map(value => ({ value, source: 'llm' }))], random(stableSeed(seed, 'options', entity.id, fact.id, index)));
        questions.push({ ...base, options: mixed.map(option => option.value), option_sources: mixed.map(option => option.source), correct_index: mixed.findIndex(option => option.source === 'correct') });
      });
    }
  }
  return { questions, skipped, needsLlm, llmItems };
}

export function toCsv(questions) {
  const header = ['type', 'qa_id', 'gold_answer_id', 'entity_id', 'entity_name', 'fact_id', 'aspect', 'question', 'answer', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_letter', 'evidence_excerpt', 'source', 'kb_status', 'answer_origin', 'confidence', 'review_status', 'requires_image', 'option_a_source', 'option_b_source', 'option_c_source', 'option_d_source'];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = questions.map(q => [q.type, q.qa_id, q.gold_answer_id, q.entity_id, q.entity_name, q.fact_id, q.aspect, q.question, q.answer,
    ...(q.options || ['', '', '', '']), q.options ? 'ABCD'[q.correct_index] : '', q.evidence, q.source, q.kb_status, q.answer_origin, q.confidence, q.review_status, q.requires_image, ...(q.option_sources || ['', '', '', ''])]);
  return '\uFEFF' + [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
}
