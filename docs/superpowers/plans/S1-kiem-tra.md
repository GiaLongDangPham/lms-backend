# Kết quả xác minh khung local · 11/10/2026

Task: **S1** · Bằng chứng lịch sử ngày 11/10, giữ nguyên kết quả đã ghi nhận.
[Spec](../specs/S1-moi-truong.md) · [Plan](S1-moi-truong.md).

## Đã kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| Backend `npm run check` | ESLint + TypeScript + 7 test HTTP + build đạt |
| Frontend `npm run check` | ESLint + 3 test API client + TypeScript/build đạt |
| `npm run db:check` | `SELECT 1` thành công trên PostgreSQL thật |
| Docker Compose | PostgreSQL healthy, host `127.0.0.1:15432` |
| API đã build | `/api/health` và `/api/ready` trả 200; database connected |
| CORS | Origin `http://localhost:5173` được cho phép; origin khác không có header allow-origin |
| Trình duyệt | FE gọi API thật; trang hiển thị BE và PostgreSQL đã kết nối |
| DB tạm dừng | Trang vẫn báo BE đã kết nối, DB chưa kết nối và có hướng dẫn thử lại |
| DB khởi động lại | Nút Kiểm tra lại đưa DB về trạng thái đã kết nối |
| Console khi kết nối thành công | Không thấy lỗi/cảnh báo trong log trình duyệt đã đọc |
| Reflow | Viewport quan sát thực tế 600px, content width 600px, không tràn ngang |
| Git ignore | `.env`, `node_modules`, `dist` đều được bỏ qua trong hai repo |
| Lockfile | Dependency và engine trong lockfile khớp package.json của cả hai repo |

Test HTTP kiểm tra health độc lập DB, readiness, không lộ thông tin kết nối, preflight,
origin ngoài allowlist, route không tồn tại, JSON lỗi và payload vượt giới hạn.
Test client kiểm tra response sai shape, DB 503, lỗi mạng và HTTP lỗi dù payload báo ok.

Review frontend bằng checklist đã đối chiếu semantic HTML, heading, nhãn button,
live region và lỗi async. Cảnh báo heuristic `await` thiếu try/catch được đánh giá:
`Promise.allSettled` thu nhận lỗi cả hai lời gọi và render trạng thái lỗi có retry.
Chưa chứng nhận screen reader, kiểm thử toàn bộ accessibility hay module nghiệp vụ.

## Các vấn đề môi trường đã xử lý

- Network/localhost trong sandbox bị hạn chế; cài package và test kết nối được chạy
  qua quyền thực thi được công cụ chấp thuận. Test HTTP đạt khi có quyền localhost.
- Docker Desktop được khởi động; cổng host 5432 không bind được, cấu hình local dùng
  15432. PostgreSQL trong container và CI Linux vẫn dùng 5432.
- ESLint 9 đã hết hỗ trợ theo metadata npm; dùng ESLint 10 và minimum Node 22.13.

## Trạng thái bàn giao

- Trang local `http://localhost:5173`; backend `http://localhost:3000/api`.
- Backend đang chạy bản build qua `npm start`; frontend chạy Vite dev.
- PostgreSQL local đang chạy, dữ liệu nằm trong volume `lms-local_postgres-data`.
- Mã và lockfile ở local; workflow GitHub đã cấu hình, chưa có lần chạy CI trên remote.
- S1 còn staging, quyền cả nhóm và xác nhận mỗi người tự chạy theo README.
- DB schema/migration/seed nghiệp vụ thuộc D1; API spec/mock thuộc D2; FE app shell
  theo role thuộc F0. Các phần này chưa được coi hoàn thành bởi khung S1.

Ảnh kiểm tra local: [FE–BE–DB đã kết nối](../../../../tmp/verification/s1-local.jpg).

Giờ thực tế/standup do Long ghi; chưa cập nhật Tracker hay đóng issue.
