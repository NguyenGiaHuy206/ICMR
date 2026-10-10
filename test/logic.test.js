import test from 'node:test';
import assert from 'node:assert/strict';
import { mockEntities } from '../dist/data.js';
import { generateQuestions, normalizeKnowledgeBase, toCsv } from '../dist/logic.js';

const entities = normalizeKnowledgeBase(mockEntities);
const selectedIds = entities.map(entity => entity.id);

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
    assert.equal(question.options, undefined);
  }
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

test('Generation is reproducible from the seed', () => {
  const input = { entities, type: 'mcq', selectedIds, perEntity: 3, seed: 12 };
  assert.deepEqual(generateQuestions(input), generateQuestions(input));
});
