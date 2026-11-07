import { aspectLabels } from './data.js';
import { addEntity, addFact, updateFact, removeFact, generateQuestions, normalizeKnowledgeBase, toCsv } from './logic.js';

const $ = selector => document.querySelector(selector);
const make = (tag, className = '', content = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== '') node.textContent = content;
  return node;
};
let entities = [];
let mode = 'empty';
const KB_STORAGE_KEY = 'icmr-qa-kb-v1';
const KB_SOURCE_KEY = 'icmr-qa-kb-source';
const KB_VERSION_KEY = 'icmr-qa-kb-project-version';
try {
  const saved = localStorage.getItem(KB_STORAGE_KEY);
  const savedSource = localStorage.getItem(KB_SOURCE_KEY);
  if (saved) {
    // Older builds stored the project KB as if it were a user import. Discard
    // that unmarked cache so the current project KB is fetched from disk.
    if (savedSource === 'imported' || savedSource === 'project') {
      const savedEntities = normalizeKnowledgeBase(JSON.parse(saved))
        .map(entity => ({ ...entity, facts: entity.facts.filter(fact => fact.status !== 'mock') }))
        .filter(entity => entity.facts.length);
      if (savedEntities.length) { entities = savedEntities; mode = savedSource; }
      else localStorage.removeItem(KB_STORAGE_KEY);
    } else {
      localStorage.removeItem(KB_STORAGE_KEY);
      localStorage.removeItem(KB_VERSION_KEY);
    }
  }
} catch { localStorage.removeItem(KB_STORAGE_KEY); localStorage.removeItem(KB_SOURCE_KEY); localStorage.removeItem(KB_VERSION_KEY); }
let selectedIds = new Set(entities.map(entity => entity.id));
let view = 'open';
let generated = { open: [] };
let skipped = { open: [] };
let retryState = null;

function notify(message, error = false) {
  const box = $('#notice');
  box.textContent = message;
  box.classList.toggle('error', error);
  box.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { box.hidden = true; }, 7000);
}

function setView(next) {
  view = next;
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === next));
  $('#generator-view').hidden = next === 'kb';
  $('#kb-view').hidden = next !== 'kb';
  $('#breadcrumb').textContent = next === 'open' ? 'Open-ended QA' : 'Knowledge base';
  const title = $('#page-title'); title.replaceChildren();
  if (next === 'open') { title.append('Open-ended '); title.append(make('em', '', 'QA generator')); }
  if (next === 'kb') { title.append('Knowledge base '); title.append(make('em', '', 'manager')); }
  $('#page-description').textContent = next === 'open'
    ? 'Easy questions are generated per aspect, using one claim each. Hard questions synthesize multiple claims from the same entity.'
    : 'Browse entities and edit their source claims.';
  $('#results-title').textContent = 'Open-ended question set';
  renderResults();
}

function renderEntityList() {
  const search = $('#entity-search').value.trim().toLocaleLowerCase('vi');
  const list = $('#entity-list'); list.replaceChildren();
  for (const entity of entities.filter(item => item.name.toLocaleLowerCase('vi').includes(search))) {
    const row = make('label', 'entity-row');
    const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedIds.has(entity.id);
    checkbox.addEventListener('change', () => {
      checkbox.checked ? selectedIds.add(entity.id) : selectedIds.delete(entity.id);
      $('#selection-count').textContent = `${selectedIds.size}/${entities.length} entity`;
    });
    const avatar = make('span', 'entity-avatar', entity.name.slice(0, 1));
      row.append(checkbox, avatar, make('span', 'entity-name', entity.name), make('span', 'entity-meta', `${entity.facts.length} facts · ${entity.category || 'Chưa gán danh mục'}`));
    list.append(row);
  }
  if (!list.children.length) list.append(make('p', 'section-help', 'Không tìm thấy entity.'));
  $('#selection-count').textContent = `${selectedIds.size}/${entities.length} entity`;
}

function renderResults() {
  if (view === 'kb') return;
  const items = generated[view];
  $('#result-count').textContent = `${items.length} câu`;
  $('#empty-results').hidden = items.length > 0;
  $('#result-toolbar').hidden = items.length === 0;
  const approved = items.filter(item => item.review_status === 'approved').length;
  $('#result-summary').textContent = `${approved} đã duyệt · ${items.length - approved} cần rà soát`;
  const skipBox = $('#skipped'); skipBox.replaceChildren();
  skipBox.hidden = skipped[view].length === 0;
  if (skipped[view].length) {
    const affectedEntities = entities.filter(entity => skipped[view].some(reason => reason.startsWith(`${entity.name}:`) || reason.startsWith(`${entity.name} ·`))).length;
    skipBox.append(make('strong', '', `${skipped[view].length} mục chưa tạo · ${affectedEntities} entity có ít nhất một mục bị bỏ qua`));
    skipBox.append(make('p', 'section-help', 'Đây không phải số entity bị bỏ qua hoàn toàn. Nếu thiếu claim cho câu hard, các câu easy của entity đó vẫn được xử lý.'));
    const list = make('ul'); skipped[view].forEach(reason => list.append(make('li', '', reason))); skipBox.append(list);
    if (view === 'open' && retryState?.pending.length) {
      const retry = make('button', 'secondary-button retry-skipped', `Thử lại ${retryState.pending.length} QA lỗi từ LLM`);
      retry.type = 'button'; retry.disabled = retryState.running;
      retry.addEventListener('click', retryFailedQa);
      skipBox.append(retry);
      skipBox.append(make('p', 'section-help', 'Các mục thiếu claim để tạo câu hard không nằm trong hàng đợi thử lại.'));
    }
  }
  const results = $('#results'); results.replaceChildren();
  items.forEach((item, index) => results.append(questionCard(item, index)));
}

function questionCard(item, index) {
  const card = make('article', 'question-card');
  const top = make('div', 'card-top');
  const claimCount = (item.fact_ids || [item.fact_id]).filter(Boolean).length;
  top.append(make('div', 'card-id', `QA ${String(index + 1).padStart(2, '0')} | ${claimCount} claim${claimCount === 1 ? '' : 's'}`));
  const tags = make('div', 'card-tags');
  tags.append(make('span', 'tag', item.aspect_label || aspectLabels[item.aspect] || item.aspect));
  tags.append(make('span', `tag ${item.difficulty === 'hard' ? 'mock' : 'approved'}`, item.difficulty === 'hard' ? 'Hard' : 'Easy'));
  const validated = ['approved', 'adjudicated', 'accepted', 'verified'].includes(item.kb_status);
  tags.append(make('span', `tag ${validated ? 'approved' : 'mock'}`, validated ? 'Đã duyệt' : 'Chưa duyệt'));
  top.append(tags); card.append(top);
  card.append(make('p', 'card-question', item.question));
  const answer = make('div', 'answer-box');
  answer.append(make('strong', '', 'GOLDEN ANSWER'), make('span', '', item.answer)); card.append(answer);
  const evidence = make('div', 'evidence');
  evidence.append(make('strong', '', `KB evidence | ${claimCount} claim${claimCount === 1 ? '' : 's'} | `), document.createTextNode(item.evidence || 'See the source claims in the knowledge base.')); card.append(evidence);
  const footer = make('div', 'card-footer');
  const sourceBox = make('span', 'card-source');
  const firstSource = item.source_refs?.find(source => /^https?:\/\//i.test(source.url));
  if (firstSource) { const link = make('a', '', firstSource.title || firstSource.source_id || firstSource.url); link.href = firstSource.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; sourceBox.append('Nguồn: ', link, firstSource.locator ? ` · ${firstSource.locator}` : ''); }
  else sourceBox.textContent = item.source || 'Chưa có nguồn đính kèm';
  footer.append(sourceBox);
  const actions = make('div', 'card-actions');
  const approve = make('button', item.review_status === 'approved' ? 'active' : '', '✓ Duyệt');
  approve.type = 'button'; approve.setAttribute('aria-label', `Duyệt câu ${index + 1}`);
  approve.addEventListener('click', () => { item.review_status = item.review_status === 'approved' ? 'draft' : 'approved'; renderResults(); });
  const reject = make('button', item.review_status === 'rejected' ? 'reject active' : 'reject', '× Loại');
  reject.type = 'button'; reject.setAttribute('aria-label', `Loại câu ${index + 1}`);
  reject.addEventListener('click', () => { item.review_status = item.review_status === 'rejected' ? 'draft' : 'rejected'; renderResults(); });
  const edit = make('button', '', '✎ Sửa'); edit.type = 'button';
  edit.addEventListener('click', () => toggleEdit(card, item));
  actions.append(approve, reject, edit); footer.append(actions); card.append(footer);
  return card;
}

function toggleEdit(card, item) {
  const old = card.querySelector('.edit-grid');
  if (old) { old.remove(); return; }
  const grid = make('div', 'edit-grid');
  const questionLabel = make('label', '', 'Câu hỏi');
  const question = make('textarea'); question.value = item.question;
  question.addEventListener('change', () => { item.question = question.value.trim() || item.question; renderResults(); });
  questionLabel.append(question); grid.append(questionLabel);
  const answerLabel = make('label', '', 'Đáp án chuẩn');
  const answer = make('input'); answer.value = item.answer;
  answer.addEventListener('change', () => {
    const value = answer.value.trim(); if (!value) return;
    item.answer = value; renderResults();
  });
  answerLabel.append(answer); grid.append(answerLabel);
  card.append(grid);
}

function download(name, data, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = make('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderKb() {
  const factEntity = $('#fact-entity');
  const previousEntity = factEntity.value;
  factEntity.replaceChildren();
  entities.forEach(entity => { const option = make('option', '', entity.name); option.value = entity.id; factEntity.append(option); });
  if (entities.some(entity => entity.id === previousEntity)) factEntity.value = previousEntity;
  $('#kb-mode-title').textContent = mode === 'project' ? 'Knowledge base trong dự án' : mode === 'empty' ? 'Chưa có dữ liệu' : 'Knowledge base đã nhập';
  const facts = entities.flatMap(entity => entity.facts);
    const stats = [['Entity', entities.length], ['Aspect claim', facts.length], ['Sẵn sàng', facts.filter(f => ['approved', 'adjudicated', 'accepted', 'verified', 'machine_accepted'].includes(f.status)).length], ['Chưa gán danh mục', entities.filter(entity => !entity.category).length]];
  const statList = $('#kb-stat-list'); statList.replaceChildren();
  stats.forEach(([label, value]) => { const block = make('div', 'kb-stat'); block.append(make('strong', '', String(value)), make('span', '', label)); statList.append(block); });
  const search = $('#kb-search').value.trim().toLocaleLowerCase('vi');
  const browser = $('#kb-entities'); browser.replaceChildren();
  entities.filter(entity => `${entity.name} ${entity.facts.map(f => f.statement).join(' ')}`.toLocaleLowerCase('vi').includes(search)).forEach(entity => {
    const details = make('details', 'kb-entity');
    const summary = make('summary'); summary.append(make('strong', '', entity.name), make('span', '', `${entity.facts.length} facts  ＋`)); details.append(summary);
    const categoryForm = make('div', 'entity-category-form');
    const categoryLabel = make('label', '', 'Danh mục');
    const category = make('input'); category.value = entity.category || ''; category.placeholder = 'Ví dụ: Đồ vật'; category.setAttribute('list', 'category-options');
    const saveCategory = make('button', '', 'Lưu danh mục'); saveCategory.type = 'button';
    saveCategory.addEventListener('click', () => {
      const value = category.value.trim();
      if (!value) return notify('Mỗi entity cần có danh mục để tạo nhiễu cùng nhóm.', true);
      saveKb(entities.map(item => item.id === entity.id ? { ...item, category: value } : item));
      notify(`Đã gán danh mục “${value}” cho ${entity.name}.`);
    });
    categoryLabel.append(category); categoryForm.append(categoryLabel, saveCategory); details.append(categoryForm);
      entity.facts.forEach(fact => {
        const block = make('div', 'kb-fact');
        const actions = make('div', 'fact-actions');
        const edit = make('button', '', 'Sửa'); edit.type = 'button';
        const remove = make('button', 'danger', 'Xóa'); remove.type = 'button';
        const editor = make('form', 'fact-editor'); editor.hidden = true;
        const aspect = make('input'); aspect.value = fact.aspect;
        const statement = make('textarea'); statement.value = fact.statement;
        const source = make('input'); source.value = fact.source || '';
        const save = make('button', '', 'Lưu fact'); save.type = 'submit';
        const cancel = make('button', '', 'Hủy'); cancel.type = 'button';
        const field = (label, control) => { const item = make('label', '', label); item.append(control); return item; };
        editor.append(field('Aspect', aspect), field('Nội dung fact', statement), field('Nguồn', source), save, cancel);
        edit.addEventListener('click', () => { editor.hidden = false; edit.hidden = true; });
        cancel.addEventListener('click', () => { editor.hidden = true; edit.hidden = false; });
        editor.addEventListener('submit', event => {
          event.preventDefault();
          try {
            saveKb(updateFact(entities, { entityId: entity.id, factId: fact.id, aspect: aspect.value, statement: statement.value, source: source.value }));
            notify('Đã cập nhật fact.');
          } catch (error) { notify(error.message, true); }
        });
        remove.addEventListener('click', () => {
          if (!confirm(`Xóa fact “${fact.statement}”?`)) return;
          try { saveKb(removeFact(entities, entity.id, fact.id)); notify('Đã xóa fact.'); } catch (error) { notify(error.message, true); }
        });
        actions.append(edit, remove);
        block.append(make('strong', '', aspectLabels[fact.aspect] || fact.aspect), make('p', '', fact.statement), make('small', '', `Golden answer sẽ được model tạo khi sinh QA · ${fact.source || 'Chưa có nguồn'}`), actions, editor);
        details.append(block);
      }); browser.append(details);
  });
  if (!browser.children.length) browser.append(make('p', 'section-help', 'Không tìm thấy dữ liệu phù hợp.'));
  $('.sidebar-note span:last-child').firstChild.textContent = mode === 'project' ? 'KB dự án đã tải' : mode === 'empty' ? 'Chưa có KB' : 'KB đã nhập';
  $('.sidebar-note small').textContent = entities.length ? `${entities.length} entity sẵn sàng` : 'Nhập file hoặc thư mục knowledge_base';
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#entity-search').addEventListener('input', renderEntityList);
$('#kb-search').addEventListener('input', renderKb);
function saveKb(next) {
  localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(next));
  if (mode !== 'project') localStorage.setItem(KB_SOURCE_KEY, 'imported');
  entities = next;
  generated = { open: [] }; skipped = { open: [] };
  retryState = null;
  renderEntityList(); renderKb();
}

$('#entity-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = Object.fromEntries(new FormData(form));
  try {
    const next = addEntity(entities, fields);
    const created = next.at(-1);
    saveKb(next); selectedIds.add(created.id);
    renderEntityList(); $('#fact-entity').value = created.id;
    form.reset(); notify(`Đã thêm ${created.name}. Hãy thêm fact cho entity này.`);
  } catch (error) { notify(error.message, true); }
});

$('#fact-aspect').addEventListener('change', event => {
  const custom = event.target.value === 'other';
  $('#custom-aspect-label').hidden = !custom;
  $('#custom-aspect').required = custom;
});

$('#fact-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = Object.fromEntries(new FormData(form));
  fields.aspect = fields.aspect === 'other' ? fields.customAspect : fields.aspect;
  try {
    const next = addFact(entities, fields);
    const fact = next.find(entity => entity.id === fields.entityId).facts.at(-1);
    saveKb(next); selectedIds.add(fields.entityId); renderEntityList();
    form.reset(); $('#fact-entity').value = fields.entityId;
    $('#custom-aspect-label').hidden = true; $('#custom-aspect').required = false;
    notify('Đã thêm fact. Model có thể tạo nhiều câu hỏi và golden answer từ nội dung này.');
  } catch (error) { notify(error.message, true); }
});
$('#select-all').addEventListener('click', () => { selectedIds = new Set(entities.map(entity => entity.id)); renderEntityList(); });
$('#deselect-all').addEventListener('click', () => { selectedIds = new Set(); renderEntityList(); });
async function refreshLlmStatus() {
  try {
    const response = await fetch('./api/llm-status');
    const status = await response.json();
    $('#llm-status').textContent = status.available ? `${status.provider} sẵn sàng (${status.model}).` : (status.reason || 'LLM chưa sẵn sàng.');
  } catch { $('#llm-status').textContent = 'Không kiểm tra được kết nối LLM.'; }
}

async function requestQaTasks(tasks, button) {
  const qaPairs = {}; const failures = {}; const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (let offset = 0; offset < tasks.length; offset++) {
    const item = tasks[offset];
    button.textContent = `Generating ${item.difficulty} ${offset + 1}/${tasks.length}: ${item.entity_name}...`;
    let lastError = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const response = await fetch('./api/generate-qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'open', items: [item] }) });
        const data = await response.json();
        if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.retryAfter = response.status === 429 ? Math.max(5, Number(data.retry_after_seconds) || 10) : 0; error.retryable = response.status === 429 || response.status >= 500; throw error; }
        const pairs = data.qa_pairs?.[item.task_id];
        if (!Array.isArray(pairs) || !pairs.length) { const details = Array.isArray(data.warnings?.[item.task_id]) ? data.warnings[item.task_id].join(' ') : ''; const error = new Error(`LLM could not produce valid QA after repair passes: ${details || 'no valid QA returned.'}`); error.retryable = false; throw error; }
        qaPairs[item.task_id] = pairs; lastError = ''; break;
      } catch (error) {
        lastError = error.message;
        const retryable = error.retryable || (!('retryable' in error) && !error.retryAfter);
        if (attempt < 4 && retryable) { const seconds = error.retryAfter || Math.min(8, 2 ** attempt); button.textContent = `API temporarily unavailable. Retrying in ${seconds}s...`; await wait(seconds * 1000); }
        else break;
      }
    }
    if (lastError) failures[item.task_id] = lastError;
  }
  return { qaPairs, failures };
}

async function retryFailedQa(event) {
  if (!retryState || retryState.running || !retryState.pending.length) return;
  const button = event.currentTarget;
  retryState.running = true; button.disabled = true; button.textContent = 'Đang thử lại...';
  const retried = await requestQaTasks(retryState.pending, button);
  Object.assign(retryState.qaPairs, retried.qaPairs);
  retryState.failures = retried.failures;
  retryState.pending = retryState.tasks.filter(task => retryState.failures[task.task_id]);
  retryState.running = false;
  const previousStatus = new Map(generated.open.map(item => [item.qa_id, item.review_status]));
  const result = generateQuestions({ ...retryState.settings, llmQaPairs: retryState.qaPairs, llmErrors: retryState.failures });
  generated.open = result.questions.map(item => ({ ...item, review_status: previousStatus.get(item.qa_id) || item.review_status }));
  skipped.open = result.skipped; renderResults();
  if (retryState.pending.length) notify(`Đã thử lại; còn ${retryState.pending.length} QA LLM chưa tạo được.`, true);
  else notify('Đã thử lại xong các QA lỗi từ LLM.');
}

$('#generate').addEventListener('click', async () => {
  if (!selectedIds.size) return notify('Select at least one entity.', true);
  const button = $('#generate'); button.disabled = true; button.textContent = 'Generating QA...';
  const settings = { entities, selectedIds: new Set(selectedIds), easyPerAspect: $('#easy-per-aspect').value, hardPerEntity: $('#hard-per-entity').value, claimsPerHard: $('#claims-per-hard').value, seed: $('#seed').value, includeUnreviewed: $('#include-drafts').checked };
  const planned = generateQuestions(settings);
  let qaPairs = {}; let failures = {};
  if (planned.llmItems.length) {
    try { ({ qaPairs, failures } = await requestQaTasks(planned.llmItems, button)); }
    catch (error) { failures = Object.fromEntries(planned.llmItems.map(item => [item.task_id, error.message])); }
  }
  const result = generateQuestions({ ...settings, llmQaPairs: qaPairs, llmErrors: failures });
  retryState = { settings, tasks: planned.llmItems, qaPairs, failures, pending: planned.llmItems.filter(item => failures[item.task_id]), running: false };
  generated.open = result.questions; skipped.open = result.skipped; renderResults();
  button.disabled = false; button.replaceChildren('Generate open-ended QA ', make('span', '', '->'));
  if (!result.questions.length) notify('The model returned no valid QA. Check the API key, model, and claim content.', true);
  else { const easy = result.questions.filter(item => item.difficulty === 'easy').length; const hard = result.questions.filter(item => item.difficulty === 'hard').length; notify(`Created ${easy} Easy and ${hard} Hard questions.`); }
});
$('#export-json').addEventListener('click', () => download('icmr-open-qa.json', JSON.stringify(generated.open, null, 2), 'application/json;charset=utf-8'));
$('#export-csv').addEventListener('click', () => download('icmr-open-qa.csv', toCsv(generated.open), 'text/csv;charset=utf-8'));
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(header => header.trim().replace(/^\uFEFF/, ''));
  return rows.filter(values => values.some(value => value.trim())).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}
function normalizeImportedQa(row, index) {
  const factIds = row.fact_ids || row.source_claim_ids || row.evidence_fact_ids || (row.fact_id ? [row.fact_id] : []);
  const ids = Array.isArray(factIds) ? factIds : String(factIds).split(/[;,]/).map(value => value.trim()).filter(Boolean);
  const evidence = row.evidence || row.evidence_excerpt || (Array.isArray(row.evidence_excerpts) ? row.evidence_excerpts.join(' | ') : '');
  const answer = row.answer || row.golden_answer || row.goldenAnswer || '';
  const question = row.question || row.query || '';
  if (!String(question).trim() || !String(answer).trim()) return null;
  return {
    ...row,
    id: row.id || `imported-qa-${index + 1}`,
    qa_id: row.qa_id || row.id || `imported-qa-${index + 1}`,
    type: 'open', difficulty: row.difficulty === 'hard' ? 'hard' : 'easy',
    entity_id: row.entity_id || '', entity_name: row.entity_name || '',
    task_id: row.task_id || '', required_claim_count: Number(row.required_claim_count) || ids.length || 1,
    fact_id: row.fact_id || ids[0] || '', fact_ids: ids, evidence_fact_ids: row.evidence_fact_ids || ids,
    aspect: row.aspect || 'other', aspect_label: row.aspect_label || row.aspect || 'Open-ended QA',
    question: String(question).trim(), answer: String(answer).trim(), evidence,
    source: row.source || '', source_refs: Array.isArray(row.source_refs) ? row.source_refs : [],
    kb_status: row.kb_status || 'unreviewed', review_status: row.review_status || 'draft',
    answer_origin: row.answer_origin || 'imported', confidence: row.confidence || 'review_required',
    requires_image: row.requires_image === true || row.requires_image === 'true'
  };
}
$('#import-qa').addEventListener('click', () => $('#qa-import-file').click());
$('#qa-import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = file.name.toLowerCase().endsWith('.csv') ? parseCsv(text) : JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : parsed.questions || parsed.items || [];
    if (!Array.isArray(rows)) throw new Error('File cần chứa một mảng câu hỏi.');
    const imported = rows.map(normalizeImportedQa).filter(Boolean);
    if (!imported.length) throw new Error('Không tìm thấy dòng nào có đủ câu hỏi và đáp án.');
    generated.open = imported; skipped.open = []; retryState = null; setView('open');
    notify(`Đã mở ${imported.length} QA từ ${file.name}.`);
  } catch (error) { notify(`Không mở được file QA: ${error.message}`, true); }
  event.target.value = '';
});
async function importKbFiles(event) {
  const files = [...(event.target.files || [])].filter(file => !file.name.startsWith('_') && /\.jsonl?$/i.test(file.name));
  if (!files.length) return notify('Không tìm thấy entity JSON trong lựa chọn.', true);
  try {
    const imported = [];
    for (const file of files) {
      const content = await file.text();
      const parsed = file.name.toLowerCase().endsWith('.jsonl') ? content.split(/\r?\n/).filter(Boolean).map((line, i) => { try { return JSON.parse(line); } catch { throw new Error(`${file.name}: JSONL dòng ${i + 1} không hợp lệ.`); } }) : JSON.parse(content);
      try { imported.push(...normalizeKnowledgeBase(parsed)); }
      catch (error) { throw new Error(`${file.webkitRelativePath || file.name}: ${error.message}`); }
    }
    const normalized = [...new Map(imported.map(entity => [entity.id, entity])).values()];
    localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(normalized));
    localStorage.setItem(KB_SOURCE_KEY, 'imported');
    localStorage.removeItem(KB_VERSION_KEY);
    entities = normalized; mode = 'imported'; selectedIds = new Set(entities.map(e => e.id));
    generated = { open: [] }; skipped = { open: [] }; retryState = null;
    renderEntityList(); renderKb(); notify(`Đã nhập ${entities.length} entity và ${entities.flatMap(e => e.facts).length} aspect claim theo schema KB.`);
  } catch (error) { notify(`Không nhập được file: ${error.message}`, true); }
  event.target.value = '';
}
$('#kb-file').addEventListener('change', importKbFiles);
$('#kb-folder').addEventListener('change', importKbFiles);

async function loadProjectKnowledgeBase() {
  if (mode === 'imported') return;
  try {
    const response = await fetch('./api/knowledge-base');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const version = String(payload.version || '');
    const savedVersion = localStorage.getItem(KB_VERSION_KEY) || '';
    if (mode === 'project' && entities.length && version && version === savedVersion) return;
    const loaded = normalizeKnowledgeBase(payload.entities || payload);
    entities = loaded;
    localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(entities));
    localStorage.setItem(KB_SOURCE_KEY, 'project');
    localStorage.setItem(KB_VERSION_KEY, version);
    selectedIds = new Set(entities.map(entity => entity.id));
    mode = 'project';
    generated = { open: [] }; skipped = { open: [] };
    renderEntityList(); renderKb();
    notify(`Đã tải ${entities.length} entity và ${entities.reduce((sum, entity) => sum + entity.facts.length, 0)} claim từ knowledge_base.`);
  } catch (error) {
    mode = 'empty';
    renderEntityList(); renderKb();
    notify(`Chưa tải được KB của dự án (${error.message}). Hãy nhập thư mục knowledge_base ở tab Knowledge base.`, true);
  }
}

renderEntityList(); renderKb(); setView('open'); refreshLlmStatus(); loadProjectKnowledgeBase();
