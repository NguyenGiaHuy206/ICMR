import test from 'node:test';
import assert from 'node:assert/strict';
import { mockEntities } from '../dist/data.js';
import { addEntity, addFact, generateQuestions, normalizeKnowledgeBase, toCsv } from '../dist/logic.js';

const entities = normalizeKnowledgeBase(mockEntities);
const selectedIds = entities.map(entity => entity.id);

test('Demo KB contains claims only; answers are extracted when generation runs', () => {
  assert.ok(mockEntities.every(entity => entity.facts.every(fact => !('answer' in fact) && !('question' in fact))));
  const facts = entities.flatMap(entity => entity.facts);
  assert.equal(facts.length, 41);
  assert.ok(facts.every(fact => fact.answer_origin === 'rule' && fact.answer !== fact.statement));
  assert.equal(entities.find(entity => entity.id === 'banh-chung').facts.find(fact => fact.aspect === 'meaning').answer, 'Đất');
});

test('MCQ has one correct option and distinct same-aspect distractors', () => {
  const { questions } = generateQuestions({ entities, type: 'mcq', selectedIds, perEntity: 6, seed: 2027 });
  assert.ok(questions.length >= 20);
  for (const question of questions) {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options.map(value => value.toLocaleLowerCase('vi'))).size, 4);
    assert.equal(question.options[question.correct_index], question.answer);
    assert.ok(question.fact_id && question.evidence && question.source);
    const pool = entities.flatMap(entity => entity.facts.filter(fact => fact.aspect === question.aspect).map(fact => fact.answer));
    question.options.forEach(option => assert.ok(pool.includes(option)));
  }
});

test('Open questions carry answers and do not put the answer text in the question', () => {
  const { questions } = generateQuestions({ entities, type: 'open', selectedIds, perEntity: 6, seed: 2027 });
  assert.ok(questions.length >= 30);
  for (const question of questions) {
    assert.ok(question.question.endsWith('?'));
    assert.ok(!question.question.toLocaleLowerCase('vi').includes(question.answer.toLocaleLowerCase('vi')));
    assert.match(question.question, /trong ảnh/i);
    assert.ok(!question.question.toLocaleLowerCase('vi').includes(question.entity_name.toLocaleLowerCase('vi')));
    assert.equal(question.requires_image, true);
    assert.equal(question.options, undefined);
  }
});

test('Both QA types refer to the image without revealing the entity name', () => {
  for (const type of ['mcq', 'open']) {
    const { questions } = generateQuestions({ entities, type, selectedIds, perEntity: 20 });
    for (const question of questions) {
      assert.match(question.question, /Món ăn trong ảnh/i);
      assert.ok(!question.question.toLocaleLowerCase('vi').includes(question.entity_name.toLocaleLowerCase('vi')));
    }
  }
  const imported = normalizeKnowledgeBase({ entities: [{ id: 'statue', name: 'Tượng A', category: 'Đồ vật', facts: [{ aspect: 'origin', statement: 'Tượng A có nguồn gốc từ Huế.', question: 'Tượng A có nguồn gốc từ đâu?', status: 'approved' }] }] });
  const result = generateQuestions({ entities: imported, type: 'open', selectedIds: ['statue'] });
  assert.match(result.questions[0].question, /Đồ vật trong ảnh/);
  assert.doesNotMatch(result.questions[0].question, /Tượng A/);
});

test('Open occasion question asks for food identity and occasion together', () => {
  const { questions } = generateQuestions({ entities, type: 'open', selectedIds: ['banh-chung'], perEntity: 20 });
  const occasion = questions.find(question => question.aspect === 'occasion');
  assert.match(occasion.question, /là gì và thường xuất hiện/);
  assert.match(occasion.answer, /Bánh chưng/);
  assert.match(occasion.answer, /Tết Nguyên đán/);
  assert.doesNotMatch(occasion.question, /Bánh chưng/);
});

test('Undervalidated claims are excluded; raw JSONL-style claims can be imported', () => {
  const kb = normalizeKnowledgeBase([
    { entity_id: 'x', entity_name: 'X', claim_id: 'c1', claim_text: 'X có hình tròn.', aspect_id: 'shape', status: 'APPROVED' },
    { entity_id: 'x', entity_name: 'X', claim_id: 'c2', claim_text: 'X có màu đỏ.', aspect_id: 'color', status: 'PENDING' }
  ]);
  const { questions } = generateQuestions({ entities: kb, type: 'open', selectedIds: ['x'], perEntity: 5 });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].fact_id, 'c1');
  assert.match(toCsv(questions), /"c1"/);
});

test('Unknown prose remains a reviewable open QA and is skipped for MCQ', () => {
  const kb = normalizeKnowledgeBase({ entities: [{ id: 'x', name: 'X', facts: [{ id: 'f1', aspect: 'custom', statement: 'X is associated with several festivals and regional variants.', status: 'approved' }] }] });
  const open = generateQuestions({ entities: kb, type: 'open', selectedIds: ['x'] });
  const mcq = generateQuestions({ entities: kb, type: 'mcq', selectedIds: ['x'] });
  assert.equal(open.questions[0].answer_origin, 'fallback');
  assert.equal(open.questions[0].confidence, 'low');
  assert.equal(mcq.questions.length, 0);
  assert.match(mcq.skipped.join(' '), /short_answer/);
});

test('Nested aspect IDs from the review KB use English extraction rules', () => {
  const kb = normalizeKnowledgeBase([{
    entity_id: 'KH_ARCHITECTURE_HERITAGE_ANGKOR_WAT', entity_name: 'Angkor Wat',
    claim_id: 'KB_000015', aspect_id: 'architecture_heritage.historical_background',
    display_name: 'Historical background',
    claim_text: 'Angkor Wat was built in the twelfth century during the reign of Suryavarman II.',
    status: 'APPROVED'
  }]);
  const fact = kb[0].facts[0];
  assert.equal(fact.answer, 'in the twelfth century during the reign of Suryavarman II');
  assert.equal(fact.answer_origin, 'rule');
  assert.equal(fact.aspect_label, 'Historical background');
});

test('Generation is reproducible from the seed', () => {
  const input = { entities, type: 'mcq', selectedIds, perEntity: 3, seed: 12 };
  assert.deepEqual(generateQuestions(input), generateQuestions(input));
});

test('A user-created entity and fact produce real open and MCQ pairs', () => {
  const withEntity = addEntity(entities, { name: 'Bánh khảo thử nghiệm', country: 'Việt Nam' });
  const created = withEntity.at(-1);
  const kb = addFact(withEntity, { entityId: created.id, aspect: 'shape', statement: 'Bánh khảo thử nghiệm có hình trụ.', source: 'Tài liệu thử' });
  const fact = kb.at(-1).facts[0];
  assert.equal(fact.answer_origin, 'rule');
  assert.notEqual(fact.answer, fact.statement);
  const open = generateQuestions({ entities: kb, type: 'open', selectedIds: [created.id] });
  const mcq = generateQuestions({ entities: kb, type: 'mcq', selectedIds: [created.id] });
  assert.equal(open.questions.length, 1);
  assert.equal(mcq.questions.length, 1);
  assert.equal(mcq.questions[0].options[mcq.questions[0].correct_index], fact.answer);
  assert.equal(normalizeKnowledgeBase(JSON.parse(JSON.stringify(kb))).at(-1).facts[0].answer, fact.answer);
  assert.equal(entities.some(entity => entity.id === created.id), false);
});

test('A custom aspect can use an optional short answer', () => {
  const kb = addFact(entities, { entityId: entities[0].id, aspect: 'color', statement: 'Món ăn có nhiều biến thể màu sắc tùy từng vùng.', shortAnswer: 'Nhiều màu sắc' });
  assert.equal(kb[0].facts.at(-1).answer, 'Nhiều màu sắc');
  assert.equal(kb[0].facts.at(-1).answer_origin, 'provided');
  assert.throws(() => addEntity(entities, { name: entities[0].name }), /tồn tại/);
});
