import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addFact, generateQuestions, normalizeKnowledgeBase, removeFact, toCsv, updateFact } from '../dist/logic.js';

const kb = normalizeKnowledgeBase({ entities: [{ id: 'site', name: 'Example Temple', category: 'Architecture / heritage', facts: [
  { id: 'c1', aspect: 'period', statement: 'The temple was built in the ninth century.', status: 'approved', source: 'A' },
  { id: 'c2', aspect: 'patron', statement: 'King Dara commissioned its main sanctuary.', status: 'approved', source: 'B' },
  { id: 'c3', aspect: 'restoration', statement: 'A restoration completed in 1911 used reinforced stone joints.', status: 'approved', source: 'C' }
] }] });

const easyPair = { question: 'During which period was this temple built?', golden_answer: 'Ninth century', answer_type: 'period', source_claim_ids: ['c1'], evidence_excerpts: ['built in the ninth century'] };
const hardPair = { question: 'How do the origins and later conservation of this temple reflect two different historical phases?', golden_answer: 'It was commissioned by King Dara and later restored in 1911 with reinforced stone joints.', answer_type: 'synthesis', source_claim_ids: ['c2', 'c3'], evidence_excerpts: ['King Dara commissioned its main sanctuary', 'restoration completed in 1911 used reinforced stone joints'] };

test('Knowledge-base v1 files preserve claim IDs and metadata', async () => {
  const raw = JSON.parse(await readFile(new URL('../../knowledge_base/architecture-heritage/indonesia/borobudur.json', import.meta.url), 'utf8'));
  const [entity] = normalizeKnowledgeBase(raw);
  assert.equal(entity.id, raw.entity_id);
  assert.equal(entity.facts[0].id, raw.aspects[0].claim_id);
  assert.equal(entity.facts[0].statement, raw.aspects[0].claim);
  assert.equal(entity.facts[0].verification.model, 'gemini-3.8-flash');
});

test('Easy tasks are generated per aspect and hard tasks retain their candidate selection target', () => {
  const result = generateQuestions({ entities: kb, selectedIds: ['site'], easyPerAspect: 2, hardPerEntity: 1, claimsPerHard: 3, seed: 9 });
  const easy = result.llmItems.filter(x => x.difficulty === 'easy');
  assert.equal(easy.length, 6);
  assert.equal(new Set(easy.map(x => x.easy_aspect)).size, 3);
  assert.equal(easy.every(x => x.claims.length === 1), true);
  assert.equal(result.llmItems.find(x => x.difficulty === 'hard').claims.length, 3);
  assert.equal(result.llmItems.find(x => x.difficulty === 'hard').required_claim_count, 3);
});

test('Task selection stays stable between request and assembly passes', () => {
  const settings = { entities: kb, selectedIds: ['site'], easyPerAspect: 2, hardPerEntity: 1, claimsPerHard: 2, seed: 2027 };
  const first = generateQuestions(settings);
  const llmQaPairs = {};
  for (const task of first.llmItems) llmQaPairs[task.task_id] = [task.difficulty === 'easy' ? { ...easyPair, source_claim_ids: [task.claims[0].fact_id] } : { ...hardPair, source_claim_ids: task.claims.slice(0, 2).map(c => c.fact_id) }];
  const second = generateQuestions({ ...settings, llmQaPairs });
  assert.deepEqual(second.llmItems.map(x => x.task_id), first.llmItems.map(x => x.task_id));
  assert.equal(second.questions.length, 7);
});

test('Generated records retain difficulty and all evidence claim IDs', () => {
  const first = generateQuestions({ entities: kb, selectedIds: ['site'], easyPerEntity: 0, hardPerEntity: 1, claimsPerHard: 2 });
  const task = first.llmItems[0];
  const selectedClaims = task.claims.slice(0, task.required_claim_count);
  const pair = { ...hardPair, source_claim_ids: selectedClaims.map(c => c.fact_id), evidence_excerpts: selectedClaims.map(c => c.statement) };
  const result = generateQuestions({ entities: kb, selectedIds: ['site'], easyPerEntity: 0, hardPerEntity: 1, claimsPerHard: 2, llmQaPairs: { [task.task_id]: [pair] } });
  assert.equal(result.questions[0].difficulty, 'hard');
  assert.equal(result.questions[0].fact_ids.length, 2);
  assert.equal(result.questions[0].required_claim_count, 2);
});

test('Facts remain editable and CSV exports difficulty and claim IDs', () => {
  const added = addFact(kb, { entityId: 'site', aspect: 'material', statement: 'The roof uses fired clay.', source: 'D' });
  const fact = added[0].facts.at(-1);
  const updated = updateFact(added, { entityId: 'site', factId: fact.id, aspect: 'material', statement: 'The roof uses red fired clay.', source: 'D' });
  assert.match(updated[0].facts.at(-1).statement, /red fired clay/);
  assert.equal(removeFact(updated, 'site', fact.id)[0].facts.length, 3);
  const csv = toCsv([{ type: 'open', difficulty: 'hard', fact_ids: ['c1', 'c2'] }]);
  assert.match(csv, /difficulty/);
  assert.match(csv, /c1;c2/);
});
