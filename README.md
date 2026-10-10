# ICMR QA Studio

Web tool tạo cặp QA từ knowledge base gồm nhiều entity và fact. Hai chức năng riêng: trắc nghiệm 4 lựa chọn và câu hỏi mở. Dữ liệu mẫu trong `dist/data.js` lấy cảm hứng từ `ICMR 2027.docx` và `OK.docx`; nội dung này **chưa được xác thực**.

## Chạy cục bộ

```powershell
cd D:\ICMR\qa-generator
npm test
npm run build
```

`dist/server/index.js` là Worker được đóng gói để chạy trên Sites. Không cần cài package.

## Đồng bộ KB thật

Trong tab Knowledge base, nhập tài khoản của ICMR Knowledge Review, tải danh sách entity, chọn tối đa 30 entity và đồng bộ. Backend đăng nhập vào API của trang review trong mỗi yêu cầu rồi chỉ trả về entity, claim, aspect, trạng thái và nguồn cần cho QA. Tài khoản, mật khẩu, session cookie và dữ liệu review cá nhân không được lưu vào mã nguồn hay `localStorage`; mật khẩu trong ô nhập được xóa khi đồng bộ thành công. KB được lưu trong `localStorage` của trình duyệt hiện tại.

Tài khoản MEMBER không có quyền dùng API export của ADMIN. Đồng bộ dùng API danh sách và chi tiết entity, vì vậy không cần quyền admin.

## Nhập knowledge base

Tại tab Knowledge base, nhập JSON dạng `{"entities":[{"id":"...","name":"...","facts":[{"id":"...","aspect":"shape","answer":"...","statement":"...","source":"...","status":"approved"}]}]}`. Có thể nhập file JSONL gồm các claim với `entity_id`, `entity_name`, `claim_id`, `aspect_id`, `claim_text`, `status`. Claim dạng văn bản được dùng làm đáp án đầy đủ; thêm `answer` hoặc `short_answer` để đáp án trắc nghiệm ngắn và rõ.

Fact có trạng thái `approved`, `adjudicated`, `accepted`, `verified` hoặc `mock` mới được sinh câu hỏi mặc định. Có thể bật chế độ thử nghiệm để dùng claim `pending` hoặc `in_progress`; kết quả được gắn nhãn chưa duyệt. Trắc nghiệm chỉ được tạo khi có ba đáp án nhiễu khác nhau trong cùng aspect. Mỗi kết quả lưu `entity_id`, `fact_id`, aspect, câu hỏi, đáp án, căn cứ và nguồn. Người dùng có thể sửa câu hỏi/đáp án, duyệt/loại và xuất JSON/CSV.

Claim gốc thường là câu văn tiếng Anh thay vì đáp án ngắn có cấu trúc. Với claim dạng này, công cụ tạo bản nháp QA có nhãn “Cần rút gọn đáp án” để người biên tập rà soát; phương án trắc nghiệm được lấy từ claim cùng aspect của entity khác. Dữ liệu không được đồng bộ giữa các thiết bị.
