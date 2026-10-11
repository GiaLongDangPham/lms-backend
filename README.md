# LMS Backend · Nhóm 2

S1 + D1 local: Express + TypeScript, PostgreSQL; endpoint hạ tầng và schema/seed nháp.
Module API nghiệp vụ bắt đầu sau CP1. Long phụ trách S1/D1/B1/B2/B6 và tích hợp; Nam làm
D2/B3/B4/B5. Nam review backend của Long; Long review backend của Nam.

## Chạy local

Yêu cầu: Node.js 22 (tối thiểu 22.13), npm, Git. PostgreSQL 17 qua Docker Desktop
(Linux containers) hoặc một PostgreSQL local có sẵn. Dùng cùng dòng Node 22 với frontend/CI.

Từ thư mục `lms-backend`, chạy trong PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
docker compose up -d --wait
npm run db:check
npm run dev
```

Chỉ copy `.env` lần đầu; nếu đã có file, sửa cấu hình hiện tại để giữ thông tin cá nhân.
Backend mặc định tại `http://localhost:3000`. `.env` được Git bỏ qua.

Nếu không dùng Docker, tạo database `lms` và user trên PostgreSQL đang chạy,
cập nhật `DATABASE_URL` rồi chạy `npm run db:check`. Không cần Docker để build/test
khung; test app dùng database giả lập, kiểm tra DB thật chạy riêng.

Trong terminal khác, kiểm tra:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod http://localhost:3000/api/ready
```

- `/api/health`: `200`, `{ "status": "ok", "service": "lms-backend" }` nếu API chạy.
- `/api/ready`: `200`, database `connected` nếu DB kết nối được; `503` nếu DB lỗi.
- JSON lỗi dùng `{ "error": { "code": "...", "message": "..." } }`.
  Đây là hợp đồng hạ tầng tạm thời; Nam chốt API nghiệp vụ trong D2.

## Lệnh kiểm tra

```powershell
npm run check
npm run db:check
npm run db:migrate
npm run db:test
npm run build
npm start
```

`check` chạy ESLint, TypeScript, test HTTP/password và build. `db:check` chạy SELECT 1.
`db:migrate` áp dụng SQL có phiên bản trên DATABASE_URL; `db:test` dùng DB local tạm,
không reset DB dự án. GitHub Actions kiểm tra migration, DB và smoke test API đã build
khi mở PR hoặc push lên `main`. Workflow đã được chuẩn bị local; cần push/PR để có
kết quả CI trên GitHub. Có `package-lock.json`; thành viên dùng `npm ci`.

Để có dữ liệu mẫu local: chạy `db:migrate`, đặt SEED_PASSWORD (tối thiểu 12 ký tự)
trong `.env`, rồi `npm run db:seed`. Seed giữ dòng và mật khẩu cũ khi chạy lại;
chỉ chạy local. Mã tài khoản ADMIN001/GV001/GV002/SV001/SV002/SV003; API đăng nhập
sẽ được viết ở B1. File metadata fixture chưa có object S3 thật.
Xem [hướng dẫn migration/seed](database/migrations/README.md).

## Cấu trúc

```text
src/
  app.ts                # Tạo Express app; không tự listen, dễ test
  server.ts             # Khởi động và tắt server/DB pool
  config/env.ts         # Đọc và kiểm tra cấu hình
  database/pool.ts      # PostgreSQL connection pool
  modules/              # Module nghiệp vụ theo D1/D2
database/migrations/    # Migration SQL có phiên bản, D1 nháp trước CP1
scripts/check-database.ts
scripts/migrate.ts      # Runner pg: transaction, checksum, advisory lock
scripts/seed.ts         # Dữ liệu mẫu chỉ cho local
scripts/test-database.ts # Kiểm thử trên DB tạm
tests/app.test.ts
docs/                   # Quyết định kỹ thuật, checklist và câu hỏi kickoff
```

## Biến môi trường

| Biến | Mục đích |
| --- | --- |
| `HOST` | Local: `127.0.0.1`; staging/container thường cần `0.0.0.0` |
| `PORT` | Cổng API, mặc định 3000 |
| `CORS_ORIGINS` | Danh sách origin FE chính xác, ngăn cách bằng dấu phẩy, không có path/dấu `/` cuối |
| `DATABASE_URL` | URL PostgreSQL; chỉ cấu hình ở backend |
| `DATABASE_SSL` | `false` cho Docker local; `true` nếu nhà cung cấp yêu cầu TLS với chứng chỉ hợp lệ |
| `POSTGRES_*` | Cấu hình Docker local; `POSTGRES_PORT` cần khớp cổng trong `DATABASE_URL` |
| `SEED_PASSWORD` | Mật khẩu local của tài khoản mới tạo qua db:seed; không ghi vào Git |

Không đưa password/token/`.env` vào PR. CORS chỉ kiểm soát trình duyệt; endpoint nghiệp
vụ còn phải có auth, kiểm tra role và quyền trong lớp ở B1/B3/B4. Frontend không được
nhận điểm/feedback Draft. Không dùng `rejectUnauthorized: false` để bỏ qua kiểm tra TLS.

## Vấn đề thường gặp

- Docker báo không kết nối engine: mở Docker Desktop, chờ Linux engine chạy; dùng
  `docker version`, `docker compose ps` để kiểm tra.
- DB local dùng cổng host 15432 (cổng trong container vẫn 5432). Nếu bị chiếm,
  đổi đồng thời `POSTGRES_PORT` và `DATABASE_URL`.
- `/health` đạt, `/ready` trả 503: kiểm tra DB và `.env`, chạy `npm run db:check`.
- FE gọi API lỗi CORS: kiểm tra origin FE, cổng và `CORS_ORIGINS`; khởi động lại BE sau khi sửa `.env`.
- Đổi user/password trong `.env` sau khi volume DB đã được tạo không tự đổi user trong DB.
  Sửa user bằng SQL hoặc chọn một volume local mới; giữ dữ liệu cũ nếu còn cần.
- `npm ci` lỗi engine: kiểm tra `node --version`, chuyển sang Node 22 >=22.13.

Dừng DB bằng `docker compose stop`; tiếp tục bằng `docker compose up -d --wait`.

## Tài liệu tiếp theo

- [Quyết định kỹ thuật](docs/technical-decisions.md)
- [Checklist chuẩn bị và S1](docs/S1-checklist.md)
- [Câu hỏi kickoff/CP1/CP2](docs/kickoff-questions.md)
- [D1: thiết kế database nháp](docs/database-design.md)
- ERD: [nguồn Mermaid](database/diagrams/lms-erd.mmd) · [sơ đồ SVG](database/diagrams/lms-erd.svg) · [chú thích](docs/database-erd.md)
- [D1: quyết định cần chốt](docs/D1-decisions.md)
- [D1: checklist và bàn giao](docs/D1-checklist.md)
- [D1: kết quả kiểm tra](docs/verification-D1.md)
- [Hướng dẫn migration/seed](database/migrations/README.md)
- [Hướng dẫn chia module](src/modules/README.md)

Branch: `S1-mo-ta-ngan`; commit: `[S1] ...`; PR: `Closes #<issue>`.
Chỉ đóng S1 khi staging chạy, FE gọi BE và cả nhóm chạy local được theo README.
