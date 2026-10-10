# ICMR QA Studio

Web tool tạo cặp QA từ knowledge base gồm nhiều entity và fact. Hai chức năng riêng: trắc nghiệm 4 lựa chọn và câu hỏi mở. Dữ liệu mẫu trong `dist/data.js` lấy cảm hứng từ `ICMR 2027.docx` và `OK.docx`; nội dung này **chưa được xác thực**.

## Chạy cục bộ

```powershell
cd D:\ICMR\qa-generator
npm test
npm run serve
```

Mở `http://localhost:4173`. Không cần cài package.

## Nhập knowledge base

Tại tab Knowledge base, nhập JSON dạng `{"entities":[{"id":"...","name":"...","facts":[{"id":"...","aspect":"shape","answer":"...","statement":"...","source":"...","status":"approved"}]}]}`. Có thể nhập file JSONL gồm các claim với `entity_id`, `entity_name`, `claim_id`, `aspect_id`, `claim_text`, `status`. Claim dạng văn bản được dùng làm đáp án đầy đủ; thêm `answer` hoặc `short_answer` để đáp án trắc nghiệm ngắn và rõ.

Fact có trạng thái `approved`, `adjudicated`, `accepted`, `verified` hoặc `mock` mới được sinh câu hỏi. Các trạng thái khác không được dùng. Trắc nghiệm chỉ được tạo khi có ba đáp án nhiễu khác nhau trong cùng aspect. Mỗi kết quả lưu `entity_id`, `fact_id`, aspect, câu hỏi, đáp án, căn cứ và nguồn. Người dùng có thể sửa câu hỏi/đáp án, duyệt/loại và xuất JSON/CSV.

File import được lưu bằng `localStorage` của trình duyệt hiện tại. Công cụ chưa kết nối API của trang review vì endpoint yêu cầu đăng nhập; dữ liệu chưa được đồng bộ giữa thiết bị.
