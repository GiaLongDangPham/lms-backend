# Checklist Long · chuẩn bị 11/10 và S1 ngày 12–13/10/2026

[Thiết kế môi trường](../specs/S1-moi-truong.md) ·
[Kết quả kiểm tra](S1-kiem-tra.md) · [Câu hỏi kickoff/checkpoint](S1-cau-hoi.md).

## Chuẩn bị hôm nay

- [x] Long chọn React + Express/TypeScript + PostgreSQL.
- [x] Xác định hai repo trống và remote GitHub có sẵn.
- [x] Tạo khung frontend/backend, `.env.example`, quy ước code và README.
- [x] Tạo Compose PostgreSQL local và health/readiness API.
- [x] Chuẩn bị workflow CI cho cả hai repo và PR template.
- [x] Soạn quyết định kỹ thuật và câu hỏi kickoff.
- [x] Ghi kết quả xác minh local vào `docs/superpowers/plans/S1-kiem-tra.md`.

## S1 · DoD phải đủ trước khi đóng issue

- [ ] Cả 5 thành viên truy cập repo, board và Tracker được.
- [ ] Kha + Long dựng board 33 issue bằng script kế hoạch; tránh tạo issue trùng.
- [ ] Nam/Khang xác nhận stack, cấu trúc repo và hợp đồng API.
- [ ] CI chạy thành công trên GitHub khi mở PR.
- [ ] Staging FE và BE chạy; FE gọi API BE thật qua CORS.
- [ ] DB và nơi lưu file staging có cấu hình phù hợp; môi trường bí mật tách riêng.
- [ ] Mỗi thành viên làm theo README và tự chạy được project local.
- [ ] Lưu link staging, PR, kết quả CI và bằng chứng thử kết nối vào issue S1.

Chuẩn bị local ngày 11/10 không thay thế tiêu chí staging. Workflow có sẵn local chưa
đồng nghĩa CI đã pass trên GitHub. PR backend của Long giao Nam review.

## Việc Long cần làm tiếp theo lịch

| Ngày | Mã | Giờ baseline | Bàn giao |
| --- | --- | --- | --- |
| 12/10 | S1 | 4 | Chốt stack, repo, môi trường; xem prototype R1 cuối ngày |
| 13/10 | S1 | 4 | Staging, CORS, CI và README; thống nhất tên thực thể với Nam |
| 14/10 | D1 | 4 | ERD, quan hệ, khóa ngoại, thiết kế history/file attachment |
| 15/10 | D1 | 4 | Migration + seed; CP1 khớp prototype/API/wireframe |
| 16/10 | B1 | 4 | Bắt đầu tài khoản/lớp/ghi danh theo spec được duyệt |
| 17–18/10 | CD | 1 | Họp tuần; báo tiến độ/vướng mắc và ghi giờ thực tế |

B1 hoàn thành 20/10, bộ test API T1b của Cát dùng để kiểm tra trước khi giao FE.
27/10 là ngày dự phòng hỗ trợ Nam, không coi là ngày phát triển tính năng bổ sung.

## Tracker và bằng chứng

Tracker: https://docs.google.com/spreadsheets/d/1HvKlMRfsfEOSjFBfbY3rnPW469DV5TsXS8WyPOakbAM/edit

- Long tự ghi Timesheet, mỗi ngày/mã một dòng; làm tròn 0,5h, ghi thời gian thực tế.
- Triển khai khung/môi trường: S1; quản lý/họp: CD; ngoài kế hoạch: KHAC + ghi chú.
- Nếu làm S1 sớm ngày 11/10, ghi đúng ngày; nhờ Kha kiểm tra tổng hợp TheoTuan vì
  ngày này nằm trước tuần baseline 12–18/10. Không chuyển ngày để khớp kế hoạch.
- Không điền % hoàn thành/giờ ước lượng thành thời gian thực tế. Không sửa Baseline.
- Mỗi tối gửi standup: `S1 · <tiến độ> · <giờ> · vướng: ...`.
- Rủi ro Long sở hữu: RK5 (FE–BE hiểu khác API); kiểm soát bằng spec/mock và CORS sớm.
- Tracker đang dùng múi giờ America/Los_Angeles; nhờ Kha xác nhận đổi sang Việt Nam.

Timesheet mẫu chỉ là hướng dẫn; không tự ghi giờ hay đóng issue thay Long/Kha.
