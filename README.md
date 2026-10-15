# ICMR QA Studio

Web tool tạo câu hỏi trắc nghiệm và câu hỏi mở bằng tiếng Anh từ knowledge base. Một fact có thể là đoạn dài và có thể sinh nhiều QA. Model tự tách các mệnh đề, viết câu hỏi mơ hồ không nêu tên entity, tạo golden answer bám sát fact, rồi tạo ba phương án nhiễu cùng kiểu ngữ nghĩa.

## Cấu hình Vilao

Tạo file `.env` từ `.env.example`:

```powershell
cd D:\ICMR\qa-generator
Copy-Item .env.example .env
notepad .env
```

Điền khóa API vào file `.env`:

```env
LLM_PROVIDER=vilao
VILAO_API_KEY=sk-...
VILAO_BASE_URL=https://api.vilao.ai/v1
VILAO_MODEL=chib/gemini-3.8-flash
PORT=4173
```

Khóa chỉ được đọc ở server local và không được gửi xuống trình duyệt. Nếu tên model trên tài khoản Vilao khác với slug trang model, sửa `VILAO_MODEL` theo model ID Vilao cung cấp.

Chạy ứng dụng:

```powershell
npm test
npm run serve
```

Mở `http://127.0.0.1:4173`. Để chia sẻ bản local, mở cửa sổ PowerShell khác và chạy:

```powershell
ngrok http 127.0.0.1:4173
```

## Dữ liệu đầu vào

Ứng dụng nhận trực tiếp schema của thư mục `knowledge_base`: mỗi file JSON chứa một entity và mảng `aspects`. Có thể chọn nhiều file hoặc dùng nút **Nhập thư mục KB**. `_manifest.json` được bỏ qua.

```json
{
  "category": "Architecture & Heritage",
  "country": "Indonesia",
  "entity_name": "Borobudur",
  "entity_id": "entity_...",
  "schema_version": "1.0",
  "synthetic": false,
  "aspects": [
    {
      "id": "aspect-...",
      "aspect_name": "Historical significance",
      "claim": "A long accepted paragraph...",
      "claim_id": "claim-...",
      "verification": {
        "status": "machine_accepted",
        "provider": "Gemini",
        "model": "gemini-3.8-flash"
      }
    }
  ]
}
```

`entity_id`, aspect `id` và `claim_id` được giữ nguyên trong dữ liệu QA để retrieval và truy vết. Công cụ vẫn tương thích với schema cũ `entities[].facts[]` và JSONL.

## Luồng sinh QA

1. Giao diện gửi riêng từng fact cùng `entity_name`, `category`, `aspect` và số câu tối đa cần tạo.
2. Model tách fact thành các mệnh đề nguyên tử khác nhau.
3. Với mỗi mệnh đề, model tạo `question`, `golden_answer`, `answer_type` và một `evidence_excerpt` ngắn bằng tiếng Anh. Câu hỏi dùng tham chiếu như “this temple” hoặc “this object” để buộc hệ thống nhận diện ảnh trước khi retrieval; golden answer chỉ được dựa trên fact.
4. Với trắc nghiệm, model dùng chính entity, câu hỏi và golden answer vừa tạo để sinh đúng ba nhiễu cùng kiểu ngữ nghĩa. Ví dụ câu hỏi năm chỉ nhận các năm; câu hỏi vật liệu chỉ nhận vật liệu.
5. Mỗi QA lưu `fact_id`, `evidence_fact_id` và `gold_answer_id`. Đoạn fact dài chỉ nằm trong KB; QA không sao chép toàn bộ đoạn đó.
6. Kết quả cần được người biên tập duyệt trước khi dùng làm benchmark.

Hai tham số trên giao diện:

- **Số fact tối đa / entity**: số fact được gửi tới model.
- **Số câu tối đa / fact**: số mệnh đề tối đa model khai thác từ mỗi fact.

Tab Knowledge base cho phép thêm entity, gán category, thêm, sửa và xóa fact. Dữ liệu chỉnh sửa được lưu trong `localStorage` của trình duyệt.

## Provider dự phòng

Ollama vẫn được hỗ trợ bằng cách đổi `.env`:

```env
LLM_PROVIDER=ollama
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b-instruct
```
