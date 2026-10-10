# ICMR QA Studio

Web tool tạo hai loại cặp QA từ knowledge base: trắc nghiệm 4 lựa chọn và câu hỏi mở. Bản demo dùng dữ liệu mẫu trong `dist/data.js`, dựa trên cấu trúc entity → aspect → claim của ICMR Knowledge Review và các ví dụ trong `ICMR 2027.docx`, `OK.docx`. Nội dung mẫu chưa được xác thực học thuật.

## Chạy cục bộ

```powershell
cd D:\ICMR\qa-generator
npm test
npm run serve
```

Mở `http://localhost:4173`. Không cần cài package.

## Dữ liệu đầu vào

Tab Knowledge base cho phép xem dữ liệu mẫu và nhập JSON dạng:

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
          "answer": "Tượng trưng cho Đất",
          "statement": "Hình vuông của bánh chưng tượng trưng cho Đất.",
          "status": "approved",
          "source": "Nguồn và vị trí trích dẫn"
        }
      ]
    }
  ]
}
```

Có thể nhập JSONL chứa `entity_id`, `entity_name`, `claim_id`, `aspect_id`, `claim_text`, `status` như dạng claim trong KB review. Trường `sources` được giữ dưới dạng nguồn tham chiếu. Nếu claim chỉ có câu văn đầy đủ, công cụ dùng cả câu làm đáp án và gắn nhãn cần rút gọn để người biên tập kiểm tra.

Mặc định chỉ fact có trạng thái `approved`, `adjudicated`, `accepted`, `verified` hoặc `mock` được dùng. Có thể bật chế độ thử nghiệm cho claim `pending` và `in_progress`. Trắc nghiệm cần ba phương án nhiễu khác nhau trong cùng aspect. Mỗi QA giữ ID entity, ID fact, trạng thái, căn cứ và nguồn; có thể sửa, duyệt/loại và xuất JSON/CSV.

Dữ liệu nhập được lưu trong `localStorage` của trình duyệt hiện tại. Web tool không đăng nhập, gọi API hay đồng bộ với ICMR Knowledge Review.
