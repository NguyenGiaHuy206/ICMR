const tidy = value => String(value || '').trim().replace(/[.!?。]+$/u, '').trim();

const rules = {
  origin: [
    /(?:có nguồn gốc từ|bắt nguồn từ|gắn với)\s+(.+)$/iu,
    /gắn\s+.+?\s+với\s+(.+)$/iu,
    /(?:originates? from|originated in|comes from)\s+(.+)$/iu
  ],
  shape: [
    /có\s+(?:hình|dáng|dạng)\s+(.+)$/iu,
    /(?:được gói|được nặn)\s+thành\s+(.+)$/iu,
    /(thuôn dài.+)$/iu,
    /(tròn,\s*.+)$/iu,
    /(?:is shaped like|has (?:a )?(?:shape|form) of)\s+(.+)$/iu
  ],
  meaning: [
    /(?:tượng trưng cho|biểu tượng (?:của|cho)|gắn với|được mô tả là)\s+(.+)$/iu,
    /(?:symbolizes|represents)\s+(.+)$/iu
  ],
  ingredients: [
    /(?:được làm từ|thường gồm|có thể gồm|gồm|có vỏ)\s+(.+)$/iu,
    /(?:is made from|made from|contains|consists of)\s+(.+)$/iu
  ],
  occasion: [
    /thường\s+(?:xuất hiện trong dịp|được dùng (?:vào|trong|cho)|được làm trong|là)\s+(.+)$/iu,
    /xuất hiện trong\s+(.+)$/iu,
    /(?:used during|eaten during|served at)\s+(.+)$/iu
  ],
  region: [
    /phổ biến ở\s+(.+)$/iu,
    /(?:popular in|common in)\s+(.+)$/iu
  ],
  historical_background: [
    /(?:was built|was founded)\s+(.+)$/iu,
    /(?:được xây dựng|được thành lập)\s+(.+)$/iu
  ]
};

export function deriveAnswer(statement, aspect) {
  const text = tidy(statement);
  const group = aspect.split('.').at(-1);
  for (const rule of rules[group] || []) {
    const match = text.match(rule);
    if (!match) continue;
    const answer = tidy(match[1]);
    if (answer.length >= 2 && answer.length < text.length) return { answer, answer_origin: 'rule', confidence: 'high' };
  }
  return { answer: text, answer_origin: 'fallback', confidence: 'low' };
}
