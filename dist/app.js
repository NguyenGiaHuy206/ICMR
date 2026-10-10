import { mockEntities, aspectLabels } from './data.js';
import { generateQuestions, normalizeKnowledgeBase, toCsv } from './logic.js';

const $ = selector => document.querySelector(selector);
const make = (tag, className = '', content = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== '') node.textContent = content;
  return node;
};
const mock = normalizeKnowledgeBase(mockEntities);
let entities = mock;
let mode = 'mock';
try {
  const saved = localStorage.getItem('icmr-qa-kb-v1');
  if (saved) { entities = normalizeKnowledgeBase(JSON.parse(saved)); mode = 'imported'; }
} catch { localStorage.removeItem('icmr-qa-kb-v1'); }
let selectedIds = new Set(entities.map(entity => entity.id));
let view = 'mcq';
let generated = { mcq: [], open: [] };
let skipped = { mcq: [], open: [] };
let remoteEntities = [];
let remoteSelected = new Set();

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
  const titles = { mcq: 'Câu hỏi trắc nghiệm', open: 'Câu hỏi mở', kb: 'Knowledge base' };
  $('#breadcrumb').textContent = titles[next];
  const title = $('#page-title');
  title.replaceChildren();
  if (next === 'mcq') { title.append('Sinh câu hỏi '); title.append(make('em', '', 'trắc nghiệm')); }
  if (next === 'open') { title.append('Sinh câu hỏi '); title.append(make('em', '', 'mở')); }
  if (next === 'kb') { title.append('Quản lý '); title.append(make('em', '', 'knowledge base')); }
  $('#page-description').textContent = next === 'mcq'
    ? 'Tạo câu hỏi từ các fact văn hóa. Phương án nhiễu được chọn trong cùng một aspect để câu hỏi có giá trị đánh giá.'
    : next === 'open'
      ? 'Tạo câu hỏi tự luận ngắn với đáp án chuẩn và căn cứ từ knowledge base, không gợi ý đáp án trong câu hỏi.'
      : 'Xem từng entity và fact, nhập dữ liệu thật khi knowledge base sẵn sàng.';
  $('#results-title').textContent = next === 'open' ? 'Bộ câu hỏi mở' : 'Bộ câu hỏi trắc nghiệm';
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
    row.append(checkbox, avatar, make('span', 'entity-name', entity.name), make('span', 'entity-meta', `${entity.facts.length} facts`));
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
    skipBox.append(make('strong', '', `${skipped[view].length} fact được bỏ qua`));
    const list = make('ul'); skipped[view].forEach(reason => list.append(make('li', '', reason))); skipBox.append(list);
  }
  const results = $('#results'); results.replaceChildren();
  items.forEach((item, index) => results.append(questionCard(item, index)));
}

function questionCard(item, index) {
  const card = make('article', 'question-card');
  const top = make('div', 'card-top');
  top.append(make('div', 'card-id', `QA ${String(index + 1).padStart(2, '0')} / ${item.fact_id}`));
  const tags = make('div', 'card-tags');
  tags.append(make('span', 'tag', item.aspect_label || aspectLabels[item.aspect] || item.aspect));
  const validated = ['approved', 'adjudicated', 'accepted', 'verified'].includes(item.kb_status);
  tags.append(make('span', `tag ${item.kb_status === 'mock' || !validated ? 'mock' : 'approved'}`, item.kb_status === 'mock' ? 'Dữ liệu mẫu' : validated ? 'Đã duyệt' : 'Chưa duyệt'));
  if (item.raw_answer) tags.append(make('span', 'tag mock', 'Cần rút gọn đáp án'));
  top.append(tags); card.append(top);
  card.append(make('p', 'card-question', item.question));
  if (item.type === 'mcq') {
    const options = make('div', 'option-list');
    item.options.forEach((value, optionIndex) => {
      const option = make('div', `option${optionIndex === item.correct_index ? ' correct' : ''}`);
      option.append(make('span', 'option-letter', 'ABCD'[optionIndex]), make('span', '', value)); options.append(option);
    }); card.append(options);
  } else {
    const answer = make('div', 'answer-box');
    answer.append(make('strong', '', 'ĐÁP ÁN CHUẨN'), make('span', '', item.answer)); card.append(answer);
  }
  const evidence = make('div', 'evidence');
  evidence.append(make('strong', '', 'Căn cứ KB · '), document.createTextNode(item.evidence)); card.append(evidence);
  const footer = make('div', 'card-footer');
  footer.append(make('span', 'card-source', item.source || 'Chưa có nguồn đính kèm'));
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
    if (item.type === 'mcq') item.options[item.correct_index] = value;
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
  $('#kb-mode-title').textContent = mode === 'mock' ? 'Dữ liệu mẫu' : 'Dữ liệu đã nhập';
  const facts = entities.flatMap(entity => entity.facts);
  const stats = [['Entity', entities.length], ['Fact / claim', facts.length], ['Sẵn sàng', facts.filter(f => ['mock', 'approved', 'adjudicated', 'accepted', 'verified'].includes(f.status)).length]];
  const statList = $('#kb-stat-list'); statList.replaceChildren();
  stats.forEach(([label, value]) => { const block = make('div', 'kb-stat'); block.append(make('strong', '', String(value)), make('span', '', label)); statList.append(block); });
  const search = $('#kb-search').value.trim().toLocaleLowerCase('vi');
  const browser = $('#kb-entities'); browser.replaceChildren();
  entities.filter(entity => `${entity.name} ${entity.facts.map(f => f.statement).join(' ')}`.toLocaleLowerCase('vi').includes(search)).forEach(entity => {
    const details = make('details', 'kb-entity');
    const summary = make('summary'); summary.append(make('strong', '', entity.name), make('span', '', `${entity.facts.length} facts  ＋`)); details.append(summary);
    entity.facts.forEach(fact => {
      const block = make('div', 'kb-fact'); block.append(make('strong', '', aspectLabels[fact.aspect] || fact.aspect), make('p', '', fact.statement), make('small', '', `${fact.status.toUpperCase()} · ${fact.source || 'Chưa có nguồn'}`)); details.append(block);
    }); browser.append(details);
  });
  if (!browser.children.length) browser.append(make('p', 'section-help', 'Không tìm thấy dữ liệu phù hợp.'));
  $('.sidebar-note span:last-child').firstChild.textContent = mode === 'mock' ? 'Chế độ dữ liệu mẫu' : 'KB đã nhập';
  $('.sidebar-note small').textContent = mode === 'mock' ? 'Chưa kết nối KB trực tiếp' : `${entities.length} entity trong trình duyệt`;
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#entity-search').addEventListener('input', renderEntityList);
$('#kb-search').addEventListener('input', renderKb);
$('#select-all').addEventListener('click', () => { selectedIds = new Set(entities.map(entity => entity.id)); renderEntityList(); });
$('#generate').addEventListener('click', () => {
  if (!selectedIds.size) return notify('Hãy chọn ít nhất một entity.', true);
  const result = generateQuestions({ entities, type: view, selectedIds, perEntity: $('#per-entity').value, seed: $('#seed').value, includeUnreviewed: $('#include-drafts').checked });
  generated[view] = result.questions; skipped[view] = result.skipped; renderResults();
  if (!result.questions.length) notify('Không tạo được câu hỏi. Kiểm tra trạng thái fact và số phương án nhiễu.', true);
  else notify(`Đã tạo ${result.questions.length} câu ${view === 'mcq' ? 'trắc nghiệm' : 'mở'}. Hãy rà soát trước khi xuất.`);
});
$('#export-json').addEventListener('click', () => download(`icmr-${view}-qa.json`, JSON.stringify(generated[view], null, 2), 'application/json;charset=utf-8'));
$('#export-csv').addEventListener('click', () => download(`icmr-${view}-qa.csv`, toCsv(generated[view]), 'text/csv;charset=utf-8'));
$('#restore-mock').addEventListener('click', () => { entities = mock; mode = 'mock'; selectedIds = new Set(entities.map(e => e.id)); generated = { mcq: [], open: [] }; skipped = { mcq: [], open: [] }; localStorage.removeItem('icmr-qa-kb-v1'); renderEntityList(); renderKb(); notify('Đã khôi phục knowledge base mẫu.'); });

async function remoteRequest(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Yêu cầu thất bại (${response.status}).`);
  return data;
}

function credentials() {
  const username = $('#kb-username').value.trim();
  const password = $('#kb-password').value;
  if (!username || !password) throw new Error('Nhập tên tài khoản và mật khẩu KB.');
  return { username, password };
}

function renderRemoteList() {
  const search = $('#remote-search').value.trim().toLocaleLowerCase('vi');
  const list = $('#remote-list'); list.replaceChildren();
  remoteEntities.filter(entity => entity.name.toLocaleLowerCase('vi').includes(search)).forEach(entity => {
    const row = make('label', 'remote-row');
    const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = remoteSelected.has(entity.entity_id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && remoteSelected.size >= 30) { checkbox.checked = false; notify('Mỗi lần chỉ đồng bộ tối đa 30 entity.', true); return; }
      checkbox.checked ? remoteSelected.add(entity.entity_id) : remoteSelected.delete(entity.entity_id);
      $('#remote-count').textContent = `${remoteSelected.size} được chọn`;
    });
    row.append(checkbox, make('span', '', entity.name), make('small', '', `${entity.claim_count || 0} claims · ${entity.approved || 0} đã duyệt`)); list.append(row);
  });
  if (!list.children.length) list.append(make('p', 'section-help', 'Không tìm thấy entity.'));
  $('#remote-count').textContent = `${remoteSelected.size} được chọn`;
}

$('#load-remote').addEventListener('click', async () => {
  const button = $('#load-remote');
  try {
    button.disabled = true; button.textContent = 'Đang tải...';
    const data = await remoteRequest('/api/kb/list', credentials());
    remoteEntities = data.entities || []; remoteSelected = new Set();
    $('#remote-picker').hidden = false; renderRemoteList();
    notify(`Đã tải ${remoteEntities.length} entity từ ICMR Knowledge Review.`);
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; button.textContent = 'Tải danh sách entity'; }
});
$('#remote-search').addEventListener('input', renderRemoteList);
$('#sync-remote').addEventListener('click', async () => {
  if (!remoteSelected.size) return notify('Hãy chọn ít nhất một entity để đồng bộ.', true);
  const button = $('#sync-remote');
  try {
    button.disabled = true; button.firstChild.textContent = 'Đang đồng bộ...';
    const data = await remoteRequest('/api/kb/sync', { ...credentials(), entityIds: [...remoteSelected] });
    const incoming = normalizeKnowledgeBase(data.entities);
    const merged = new Map((mode === 'mock' ? [] : entities).map(entity => [entity.id, entity]));
    incoming.forEach(entity => merged.set(entity.id, entity));
    entities = [...merged.values()]; mode = 'imported';
    localStorage.setItem('icmr-qa-kb-v1', JSON.stringify(entities));
    selectedIds = new Set(incoming.map(entity => entity.id));
    generated = { mcq: [], open: [] }; skipped = { mcq: [], open: [] };
    $('#kb-password').value = ''; remoteSelected = new Set(); renderRemoteList(); renderEntityList(); renderKb();
    notify(`Đã đồng bộ ${incoming.length} entity. Claim chưa duyệt chỉ được dùng khi bật chế độ thử nghiệm.`);
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; button.firstChild.textContent = 'Đồng bộ entity đã chọn '; }
});

$('#kb-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const content = await file.text();
    const parsed = file.name.toLowerCase().endsWith('.jsonl') ? content.split(/\r?\n/).filter(Boolean).map((line, i) => { try { return JSON.parse(line); } catch { throw new Error(`JSONL dòng ${i + 1} không hợp lệ.`); } }) : JSON.parse(content);
    const normalized = normalizeKnowledgeBase(parsed);
    localStorage.setItem('icmr-qa-kb-v1', JSON.stringify(normalized));
    entities = normalized; mode = 'imported'; selectedIds = new Set(entities.map(e => e.id));
    generated = { mcq: [], open: [] }; skipped = { mcq: [], open: [] };
    renderEntityList(); renderKb(); notify(`Đã nhập ${entities.length} entity và ${entities.flatMap(e => e.facts).length} fact.`);
  } catch (error) { notify(`Không nhập được file: ${error.message}`, true); }
  event.target.value = '';
});

renderEntityList(); renderKb(); setView('mcq');
