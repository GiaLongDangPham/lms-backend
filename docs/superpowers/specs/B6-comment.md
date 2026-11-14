# B6 - Backend Comment

Ngày: 13/11/2026. Chủ sở hữu: Long. Trạng thái: đã implement và kiểm tra local;
còn Nam review, CI và staging/F6 acceptance.

## Mục tiêu và phạm vi

Hoàn thành bốn operation Comment đã có trong `docs/openapi.json` để Khang nối F6:
GET/POST `/assignments/{assignmentId}/comments` và
GET/POST `/submissions/{submissionId}/comments`.
Comment phẳng, văn bản thuần; không realtime, reply, sửa/xóa, thông báo hay file đính kèm.
Không thay đổi B5, điểm, lịch sử bài nộp hoặc dữ liệu dự án.

## Thiết kế và lựa chọn

Dùng module `comments` với repository/service/router theo Express + TypeScript + pg
hiện tại; tái sử dụng auth, transaction, validation và cursor helpers. Giữ bảng comments
đã có từ migration 0001. Không cần migration hoặc thư viện mới.
Đặt logic vào router B1 sẽ làm module tài khoản thêm trách nhiệm; dựng dịch vụ riêng
hoặc realtime vượt scope. Lựa chọn của người implement: module riêng trong backend.

User đã yêu cầu tạo spec/plan rồi implement trực tiếp, không dùng sub-agent.
Review thiết kế, plan và code do chính người implement thực hiện; Nam vẫn cần review PR.

## Quyền truy cập

- Cần phiên hợp lệ, tài khoản active và đã đổi mật khẩu tạm.
- Chỉ TEACHER/STUDENT: ADMIN trả 403 theo x-roles trong contract.
- Assignment discussion: GV đang được phân công hoặc SV ghi danh active trong lớp.
- Submission discussion: GV đang được phân công hoặc SV chủ bài nộp và còn ghi danh active.
  SV khác cùng lớp không được đọc/viết thảo luận bài nộp của nhau.
- Không có target hoặc không thuộc phạm vi truy cập trả 404 cùng mã NOT_FOUND.
- Mất quyền lớp chặn cả GET/POST nhưng giữ comment lịch sử; tác giả bị khóa không
  làm mất comment cũ. Không trả email, session hoặc dữ liệu grade Draft.
- Không khóa comment theo deadline/grade/publication: thảo luận kết quả vẫn cần sau công bố.
- Kiểm tra membership và INSERT trong cùng transaction, khóa membership bằng helper
  `requireClassAccess(..., true)` để ngừng ghi danh/bỏ phân công không chen giữa hai bước.
  Với SV, bổ sung `FOR SHARE` trên enrollment: `FOR KEY SHARE` của helper hiện tại
  không chặn UPDATE cột is_active; không sửa helper dùng chung của các module khác.

Contract local còn `x-decision-pending: Q09` cho submission visibility, trong khi PDF dùng
Q09 cho deadline notification. Quyết định implementation của Long: bảo vệ riêng tư như
summary "private submission discussion" và chính sách xem submission hiện có, không coi
mọi người trong lớp đều được xem bài nộp. Đây là điểm bàn giao Nam/Kha xác nhận trước merge.

## Input/output và phân trang

- POST body chỉ nhận `{ body: string }`, trim khoảng trắng đầu/cuối, không rỗng sau trim.
  Không thêm giới hạn ký tự riêng ngoài giới hạn JSON 1 MiB hiện có; giữ contract hiện tại.
  Field thừa (authorId, target, reply...) trả 400 VALIDATION_ERROR.
- POST trả 201 Comment: id, author {id,schoolCode,fullName,role}, assignmentId,
  submissionId, body, createdAt ISO UTC. Chính xác một target khác null; tác giả từ phiên.
- GET trả 200 `{items, page:{nextCursor}}`, limit 1..100, mặc định 20; limit+1 để
  xác định trang tiếp theo. Giữ quy ước ORDER BY id tăng dần, cursor UUID của dự án;
  không hứa thứ tự thời gian. Cursor scope gồm loại target và target ID để chống dùng chéo.
  F6 reset trang sau POST, không dùng UUID cursor làm cơ chế poll sự kiện mới.
- UUID/query/cursor/body sai trả 400. Cache-Control: no-store. Văn bản được giữ dạng
  plain text, F6 phải render như text (không innerHTML).

## Nghiệm thu

Integration test HTTP thật với PostgreSQL tạm, schema response kiểm tra bằng OpenAPI.
Bao phủ GV/SV, hai lớp, SV cùng lớp khác chủ bài, ADMIN, phiên hết quyền, target không có,
body/query/cursor sai, UTF-8, phân trang, dữ liệu persistence và comment sau công bố.
`npm run check`, `npm run api:test`, `npm run db:test`, `npm run api:validate` đạt.
Phân biệt local verified với CI, Nam review, staging và F6 acceptance; không tự đánh dấu
Done nếu chưa có bằng chứng các bước ngoài local.
