# ICMR QA Studio

Web tool tạo hai loại cặp QA từ knowledge base: trắc nghiệm 4 lựa chọn và câu hỏi mở. Bản demo dùng 41 claim mẫu trong `dist/data.js`, dựa trên cấu trúc entity → aspect → claim của ICMR Knowledge Review và các ví dụ trong `ICMR 2027.docx`, `OK.docx`. Dữ liệu mẫu chỉ chứa claim, không chứa câu hỏi hoặc đáp án soạn sẵn. Nội dung mẫu chưa được xác thực học thuật.

## Chạy cục bộ

```powershell
cd D:\ICMR\qa-generator
npm test
npm run serve
```

Mở `http://localhost:4173`. Không cần cài package.

## Dữ liệu đầu vào

Tab Knowledge base cho phép thêm entity, thêm fact cho entity đã chọn, xem dữ liệu mẫu và nhập JSON dạng:

```json
{
  "entities": [
    {
      "id": "banh-chung",
      "name": "Bánh chưng",
      "facts": [
        {
          "id": "claim-1",
          "aspect": "meaning",
          "statement": "Hình vuông của bánh chưng tượng trưng cho Đất.",
          "status": "approved",
          "source": "Nguồn và vị trí trích dẫn"
        }
      ]
    }
  ]
}
```

Có thể nhập JSONL chứa `entity_id`, `entity_name`, `claim_id`, `aspect_id`, `claim_text`, `status` như dạng claim trong KB review. Trường `sources` được giữ dưới dạng nguồn tham chiếu. Có thể bổ sung `short_answer` khi claim quá phức tạp để rút bằng rule.

## Logic sinh QA

1. `dist/logic.js` chuẩn hóa entity, claim, aspect, trạng thái và nguồn từ KB.
2. `dist/derive.js` rút đáp án ngắn từ claim bằng các rule theo aspect (nguồn gốc, hình dáng, ý nghĩa, thành phần, dịp dùng, vùng phổ biến và một số mẫu tiếng Anh). Rule có thể mở rộng khi KB bổ sung loại claim mới.
3. `dist/logic.js` tạo câu hỏi từ template theo aspect. Với trắc nghiệm, ba phương án nhiễu được lấy từ đáp án của **entity khác trong cùng aspect**, loại trùng và trộn thứ tự bằng seed để tái lập kết quả.
4. Nếu không rút được đáp án ngắn, claim vẫn tạo được bản nháp câu hỏi mở với độ tin cậy thấp; trắc nghiệm được bỏ qua và báo lý do. Mỗi QA giữ ID claim, căn cứ, trạng thái KB, nguồn và phương pháp trích xuất để kiểm tra.

Mặc định chỉ fact có trạng thái `approved`, `adjudicated`, `accepted`, `verified` hoặc `mock` được dùng. Có thể bật chế độ thử nghiệm cho claim `pending` và `in_progress`. Có thể sửa, duyệt/loại và xuất JSON/CSV.

Dữ liệu nhập được lưu trong `localStorage` của trình duyệt hiện tại. Web tool không đăng nhập, gọi API hay đồng bộ với ICMR Knowledge Review.
