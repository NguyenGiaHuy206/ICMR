# ICMR Open-ended QA Studio

Web tool tao cau hoi open-ended bang tieng Anh tu du lieu that trong thu muc `D:\ICMR\knowledge_base`. Khong co entity hay claim mau trong ung dung. Tool chia cau hoi thanh hai muc:

- **Easy**: tao theo tung aspect; mac dinh moi aspect sinh 2 cau, moi cau chi can mot claim va co cau tra loi ngan gon. Co the doi so cau trong muc cai dat.
- **Hard**: phai ket hop it nhat hai claim cua cung mot entity de tao mot cau tra loi day du.

Cau hoi khong neu ten entity, quoc gia, dan toc, vung, tinh hay thanh pho. No dung cac cach goi nhu `this temple`, `this dish` hoac `this object` de buoc he thong nhan dien doi tuong tu anh truoc khi retrieval.

## Cau hinh Vilao

Tao `.env` tu `.env.example` va dien API key:

```env
LLM_PROVIDER=vilao
VILAO_API_KEY=sk-...
VILAO_BASE_URL=https://api.vilao.ai/v1
VILAO_MODEL=chib/gemini-3.8-flash
PORT=4173
```

API key chi duoc doc tai server local va khong duoc gui xuong trinh duyet.

Chay ung dung:

```powershell
cd D:\ICMR\qa-generator
npm.cmd test
npm.cmd run serve
```

Mo `http://127.0.0.1:4173`. De chia se ban local, mo PowerShell khac va chay:

```powershell
ngrok http 127.0.0.1:4173
```

## Du lieu dau vao

Khi chay local, server doc truc tiep cac file JSON trong thu muc `D:\ICMR\knowledge_base` (bo qua `_manifest.json`) va nap vao giao dien. Moi file JSON chua mot entity va mang `aspects`. Cac truong `entity_id`, aspect `id` va `claim_id` duoc giu nguyen de retrieval va truy vet.

```json
{
  "category": "Architecture & Heritage",
  "entity_name": "Borobudur",
  "entity_id": "entity_...",
  "aspects": [
    {
      "id": "aspect-...",
      "aspect_name": "Historical significance",
      "claim": "A long accepted paragraph...",
      "claim_id": "claim-...",
      "verification": { "status": "machine_accepted" }
    }
  ]
}
```

Neu deploy ngoai may local hoac muon chon bo du lieu khac, co the nhap schema cu `entities[].facts[]`, JSON hoac JSONL trong tab Knowledge base. Tab Knowledge base cho phep them entity, gan category, them, sua va xoa fact.

## Luong sinh QA

1. Tool chon claim theo tung entity bang seed co dinh.
2. Moi tac vu Easy gui mot claim cho model.
3. Moi tac vu Hard gui tu 2 den 6 claim cua cung entity.
4. Model viet cau hoi mo ho bang tieng Anh, tao golden answer va tra ve ID cua tat ca claim da dung.
5. Backend kiem tra Easy chi tham chieu mot claim; Hard phai tham chieu it nhat hai claim.
6. Neu output khong dung schema, backend tu dong yeu cau model sua lai toi da ba lan.
7. Ket qua luu `difficulty`, `task_id`, `fact_ids`, `gold_answer_id` va evidence de truy vet.

## Tham so giao dien

- **So cau de / entity**: so tac vu Easy, moi cau dung mot claim.
- **So cau kho / entity**: so tac vu Hard can tao.
- **So claim / cau kho**: so claim cap cho model trong moi tac vu Hard, tu 2 den 6.
- **Seed**: giu viec chon claim on dinh giua lan gui model va lan lap ket qua.

## Provider du phong

```env
LLM_PROVIDER=ollama
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b-instruct
```
