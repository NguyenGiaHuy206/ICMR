import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addFact, generateQuestions, normalizeKnowledgeBase, removeFact, toCsv, updateFact } from '../dist/logic.js';

const longStatement = 'Công trình được bắt đầu xây dựng khoảng năm 780. Vua Samaratungga hoàn thành công trình năm 825. UNESCO ghi danh công trình là Di sản thế giới năm 1991.';
const kb = normalizeKnowledgeBase({ entities: [{ id: 'borobudur', name: 'Borobudur', category: 'Công trình / di sản', facts: [{ id: 'history', aspect: 'historical_significance', statement: longStatement, status: 'approved', source: 'Tài liệu A' }] }] });
const pairs = { history: [
  { qa_id: 'history:qa:1', question: 'Công trình trong ảnh bắt đầu được xây dựng vào khoảng năm nào?', golden_answer: 'Khoảng năm 780', answer_type: 'year', distractors: ['Khoảng năm 720', 'Khoảng năm 833', 'Khoảng năm 900'], evidence_excerpt: 'bắt đầu xây dựng khoảng năm 780' },
  { qa_id: 'history:qa:2', question: 'Ai đã hoàn thành công trình trong ảnh vào năm 825?', golden_answer: 'Vua Samaratungga', answer_type: 'person', distractors: ['Vua Sanjaya', 'Vua Balitung', 'Vua Airlangga'], evidence_excerpt: 'Vua Samaratungga hoàn thành công trình năm 825' },
  { qa_id: 'history:qa:3', question: 'UNESCO ghi danh công trình trong ảnh vào năm nào?', golden_answer: 'Năm 1991', answer_type: 'year', distractors: ['Năm 1973', 'Năm 1982', 'Năm 2012'], evidence_excerpt: 'UNESCO ghi danh công trình là Di sản thế giới năm 1991' }
] };

test('Knowledge-base v1 entity files preserve retrieval IDs and verification metadata', async () => {
  const raw = JSON.parse(await readFile(new URL('../../knowledge_base/architecture-heritage/indonesia/borobudur.json', import.meta.url), 'utf8'));
  const [entity] = normalizeKnowledgeBase(raw);
  assert.equal(entity.id, raw.entity_id);
  assert.equal(entity.name, raw.entity_name);
  assert.equal(entity.category, raw.category);
  assert.equal(entity.schema_version, '1.0');
  assert.equal(entity.facts.length, raw.aspects.length);
  assert.equal(entity.facts[0].id, raw.aspects[0].claim_id);
  assert.equal(entity.facts[0].aspect_id, raw.aspects[0].id);
  assert.equal(entity.facts[0].aspect, raw.aspects[0].aspect_name);
  assert.equal(entity.facts[0].statement, raw.aspects[0].claim);
  assert.equal(entity.facts[0].status, 'machine_accepted');
  assert.equal(entity.facts[0].verification.model, 'gemini-3.8-flash');
});

test('A long fact is sent to the LLM once with a configurable number of questions', () => {
  const result = generateQuestions({ entities: kb, type: 'mcq', selectedIds: ['borobudur'], perEntity: 1, perFact: 3 });
  assert.equal(result.questions.length, 0);
  assert.equal(result.llmItems.length, 1);
  assert.equal(result.llmItems[0].statement, longStatement);
  assert.equal(result.llmItems[0].questions_per_fact, 3);
  assert.equal('correct_answer' in result.llmItems[0], false);
});

test('One fact can produce multiple MCQs with fact and golden-answer references', () => {
  const result = generateQuestions({ entities: kb, type: 'mcq', selectedIds: ['borobudur'], perEntity: 1, perFact: 3, llmQaPairs: pairs, seed: 7 });
  assert.equal(result.questions.length, 3);
  for (const question of result.questions) {
    assert.equal(question.fact_id, 'history');
    assert.match(question.gold_answer_id, /^history:gold:/);
    assert.equal(question.evidence_fact_id, 'history');
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.equal(question.options[question.correct_index], question.answer);
    assert.equal(question.answer_origin, 'llm_grounded');
  }
});

test('Per-fact limit is enforced when the model returns more pairs', () => {
  const result = generateQuestions({ entities: kb, type: 'open', selectedIds: ['borobudur'], perEntity: 1, perFact: 2, llmQaPairs: pairs });
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions.every(question => !question.options), true);
});

test('Invalid MCQ output is skipped rather than mixing unrelated fallback choices', () => {
  const invalid = { history: [{ question: 'Công trình trong ảnh hoàn thành khi nào?', golden_answer: 'Năm 825', distractors: ['Năm 800'], evidence_excerpt: 'năm 825' }] };
  const result = generateQuestions({ entities: kb, type: 'mcq', selectedIds: ['borobudur'], perEntity: 1, perFact: 1, llmQaPairs: invalid });
  assert.equal(result.questions.length, 0);
  assert.match(result.skipped.join(' '), /không trả đủ 3/);
});

test('Facts remain editable without a short-answer field', () => {
  const added = addFact(kb, { entityId: 'borobudur', aspect: 'restoration', statement: 'Công trình được phục dựng từ năm 1907 đến 1911.', source: 'Tài liệu B' });
  const fact = added[0].facts.at(-1);
  const updated = updateFact(added, { entityId: 'borobudur', factId: fact.id, aspect: 'restoration', statement: 'Công trình được phục dựng và hoàn tất năm 1911.', source: 'Tài liệu C' });
  assert.match(updated[0].facts.at(-1).statement, /1911/);
  assert.equal(removeFact(updated, 'borobudur', fact.id)[0].facts.length, 1);
});

test('CSV exports QA and gold answer IDs', () => {
  const questions = generateQuestions({ entities: kb, type: 'open', selectedIds: ['borobudur'], perEntity: 1, perFact: 1, llmQaPairs: pairs }).questions;
  const csv = toCsv(questions);
  assert.match(csv, /gold_answer_id/);
  assert.match(csv, /history:gold:1/);
});
