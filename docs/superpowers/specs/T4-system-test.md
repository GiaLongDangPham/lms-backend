# T4 - System test và regression

21/11/2026, Long; BE/FE nhánh `T4-system-test-regression` từ I2b. Làm trực tiếp.
Nguồn: QA 19/11 trong TestCase/KiemThu/VanDe; kết quả cũ 47/56 Pass, 9 Fail.

## Phạm vi sửa và nghiệm thu

- Bug-03/Q2: mọi lần nộp khi chưa grade/publication được nhận kể cả sau hạn;
  phiên bản Late theo deadline snapshot, lịch sử cũ bất biến. Grade Draft/Published
  và assignment publication vẫn khóa; không bỏ auth, file validation hay transaction.
- Bug-04: khi tạo assignment, deadline phải > giờ PostgreSQL hiện tại, 400 nếu sai.
  PATCH giữ rule hiện có (không tự cấm lịch sử/gia hạn). FE validate trước gửi.
- Bug-05: GV được phân công thấy số phiên bản và toàn bộ lịch sử/tệp ở màn chấm.
- Bug-06: SV có Published result dù chưa submission không thấy nút nộp;
  truy cập thẳng form cũng chặn, error khóa nộp có thông điệp tiếng Việt.
- Bug-07/Fail-07: bảng GV hiện grade 0/correction và source đúng cho người không nộp,
  dùng một nguồn aggregate có cursor theo assignment, không fetch history N+1.
- Bug-08: Published result có gradedBy (identity only, nullable cho auto-zero),
  SV không thấy Draft; lịch sử UI đánh số công bố 1..n thay vì revision nội bộ.
- Bug-09 đã sửa I2a; kiểm tra hồi quy cùng notification/menu/read.
- Bug-10: bỏ hoàn toàn dòng mật khẩu demo hard-code khỏi trang login; sửa label password id.
- Fail-05/06 retest độ chính xác 2 số thập phân và sửa kết quả không có submission.

## Kiến trúc/quyết định

Tái sử dụng assignment/assessment service + row locks, không rewrite module.
GET `/assignments/{assignmentId}/grades` là aggregate teacher-only, paging cursor
theo grade UUID; trả GradePage (student summary/grade/source/provenance) như GET grade
đã có. Ngoài lớp 404, STUDENT/ADMIN 403. Contract thêm đúng operation này, không
endpoint import/CSV/unpublish. FE gradebook join theo student ID, giữ người ngừng
ghi danh có bài/grade trong lịch sử; không hardcode 0 khi chưa publication.
PublishedGrade thêm gradedBy nullable, không thêm gradedAt hay Draft snapshot.

Rule Q2 lấy quyết định QA Kha giữ 19/11; cập nhật D2/OpenAPI/mock/readme/test cũ
đang cấm nộp lại trễ. Submission comment riêng vẫn giữ backend authorization I2b;
F6 MVP chung assignment. Không thay thiết kế nhận diện, UI kit hay nghiệp vụ khác.

## Verification

Test RED/GREEN cho late version, deadline creation, aggregate access và published
grader privacy. Browser FE thật/BE thật/PostgreSQL tạm chứng minh lịch sử GV, bảng 0,
khóa direct form, feedback/history SV, 2 decimals, notifications và common comments.
Full static/unit/API/DB + OpenAPI/mock + diff check. Không tuyên bố 56 QA case pass
nếu chưa chạy lại đủ bước môi trường/actors; ghi mapping case và giới hạn local.
User chưa deploy: cấu hình I2b sẵn nhưng staging/T4 QA nghiệm thu là gate ngoài.
