# Migration SQL · D1

Long đã chọn SQL có phiên bản dùng pg. `0001` tạo 15 bảng nghiệp vụ; `0002` thêm
hai bảng auth và trường đổi mật khẩu. `0003_client_rules.sql` thêm lịch sử điểm,
định danh kết quả theo bài tập/ghi danh, điểm tự động khi không nộp, note từng version
và mã học phần. [ERD](../../docs/database-erd.md) hiện có 18 bảng, chưa tính
`schema_migrations`. Các rule còn mở nằm trong [D1-decisions.md](../../docs/D1-decisions.md).

## Chạy local

Từ thư mục backend, sau `npm ci` và cấu hình `.env`:

```powershell
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run db:test
```

Trước seed, đặt `SEED_PASSWORD` trong `.env` (12–256 ký tự). File này được Git bỏ qua.
Seed chỉ chạy trên host PostgreSQL localhost/127.0.0.1/::1 và NODE_ENV khác production;
không dùng seed này để tự đưa tài khoản demo lên staging.

## Runner và lịch sử

- Đọc các file `NNNN_mo_ta.sql` theo thứ tự. Không dùng trùng số phiên bản.
- Lưu tên file, SHA-256 và thời điểm áp dụng trong `schema_migrations` (bảng hạ tầng
  ngoài 18 bảng nghiệp vụ/auth).
- Mỗi file chạy trong một transaction; lỗi SQL rollback cả DDL và bản ghi lịch sử.
- Advisory lock trên một connection bảo đảm không chạy seed/migration đồng thời.
  Lock đang bận thì lệnh thất bại, không chờ vô hạn.
- File đã áp dụng phải còn trong repo, cùng checksum và cùng thứ tự. Không sửa
  file sau khi áp dụng; bổ sung migration có số tiếp theo để thay đổi schema.
- SQL trong file không tự BEGIN/COMMIT, không dùng lệnh không chạy được trong
  transaction như CREATE INDEX CONCURRENTLY. Runner hiện dành cho migration transactional.
- Lock timeout 10 giây; statement timeout 60 giây. Migration dữ liệu lớn sau này
  phải có kế hoạch riêng và điều chỉnh timeout khi cần.
- Không tự migrate trong `npm start`, không có lệnh reset/drop database dự án.

Runner dùng tsx (dev dependency). Job chạy migration cần `npm ci --include=dev`;
không gọi lệnh tsx sau khi chỉ cài production dependencies. CI đã cài đầy đủ.

Nếu migrate thất bại, sửa lỗi ở **file chưa được áp dụng** rồi chạy lại. Nếu file
đã được áp dụng, tạo migration mới. Các migration trước đó vẫn được giữ nếu file
sau lỗi; transaction là từng file, không phải toàn bộ một đợt deploy.

## Nâng cấp 0003 trên dữ liệu có sẵn

Sao lưu DB trước khi nâng cấp môi trường dùng chung. Hai lớp demo đúng ID/mã fixture
được gán DEMO-COURSE-A/B. Lớp khác phải có mã học phần thực tế do nhóm xác nhận:

```powershell
$env:CLASS_COURSE_MAPPING='{"UUID-CUA-LOP":"CO2013"}'
npm run db:migrate
Remove-Item Env:CLASS_COURSE_MAPPING
```

Thay placeholder bằng UUID lớp; mã uppercase gồm chữ, số, `_`, `-` tối đa 50 ký tự.
Thiếu lớp trong mapping thì toàn bộ 0003 rollback, giữ nguyên schema/data trước đó.
Không suy mã học phần từ mã lớp. Grade cũ giữ score/feedback/status/version và được
snapshot vào lịch sử; Published riêng lẻ cũ không tự đóng công bố toàn bài. Nếu grade
cũ trỏ v1 trong khi đã có v2, vẫn sửa/công bố v1 được, không gán ngầm điểm sang v2.

## Seed và tài khoản giả lập

| Mã đăng nhập | Role | Quan hệ |
| --- | --- | --- |
| ADMIN001 | ADMIN | Tạo lớp/phân công/ghi danh |
| GV001 | TEACHER | Lớp A |
| GV002 | TEACHER | Lớp A và B |
| SV001 | STUDENT | Lớp A, hai phiên bản nộp và một hồ sơ nộp trễ |
| SV002 | STUDENT | Lớp A, kết quả Published |
| SV003 | STUDENT | Lớp B, bài chưa nộp |

Mật khẩu của tài khoản **mới tạo** là SEED_PASSWORD tại lần seed đầu tiên, được hash
scrypt với salt riêng. Chạy seed lại thêm dữ liệu còn thiếu, không ghi đè dòng tồn
tại và không đổi mật khẩu. Đổi SEED_PASSWORD không reset password tài khoản cũ.
Nếu ID tài khoản seed đã mang mã/role khác, seed thất bại và rollback.

Có 48 dòng fixture: 6 user, 2 lớp, 3 phân công GV, 3 ghi danh, 2 tài liệu, 3 bài tập,
3 hồ sơ nộp, 4 phiên bản, 2 điểm, 8 file metadata, 8 dòng gắn file, 2 thông báo,
2 comment. Trigger tạo thêm 2 snapshot lịch sử điểm (50 dòng vật lý, không tính auth
sessions/schema_migrations). Dates dùng mốc cố định 20/10/2026 để kiểm tra lịch sử; thang 10 là fixture,
không chốt thang điểm của toàn hệ thống.

File có provider `fixture`: chưa có PDF/object thật, không phải kết quả thử S3.
API đăng nhập/quyền và luồng grading hiện đã có; rule deadline còn mở, giao diện và
storage thực tế vẫn thuộc các module tiếp theo. Seed không phải bộ nghiệm thu UI/S3.

## Bộ kiểm thử DB

`db:test` tạo database `lms_d1_check_<random>` trên PostgreSQL **local**, dùng
migration/seed rồi kiểm tra lỗi ràng buộc, transaction, checksum và chạy lại. Chỉ
database tạm được chính lần chạy đó tạo mới được drop; database dự án được giữ.

User DB chạy kiểm thử cần quyền CREATEDB (user Docker/CI hiện có quyền này).
CI gọi lệnh này sau `db:migrate`. Xem [kết quả D1](../../docs/verification-D1.md).
