export const aspectLabels = {
  origin: 'Nguồn gốc',
  shape: 'Hình dáng',
  meaning: 'Ý nghĩa',
  ingredients: 'Thành phần',
  occasion: 'Dịp sử dụng',
  region: 'Khu vực phổ biến'
};

// UI labels only. Entity and claim content is loaded from the real knowledge base.
export const questionTemplates = {
  origin: subject => `${subject} có nguồn gốc hoặc gắn với truyền thống nào?`,
  shape: subject => `${subject} có hình dáng đặc trưng như thế nào?`,
  meaning: subject => `${subject} mang ý nghĩa hoặc biểu tượng gì?`,
  ingredients: subject => `Thành phần chính của ${subject.toLowerCase()} là gì?`,
  occasion: subject => `${subject} thường xuất hiện trong dịp hoặc hoàn cảnh nào?`,
  region: subject => `${subject} phổ biến ở khu vực nào?`
};
