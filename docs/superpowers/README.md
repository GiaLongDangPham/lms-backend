# Tài liệu task của Long

Đầu mối tài liệu S1/D1/B1/B2/F2 của Long để team review theo từng phạm vi thay đổi.
Quy ước tên và sắp xếp dưới đây chỉ áp dụng cho tài liệu của Long. Tài liệu D2,
B3/B4 của thành viên khác giữ nguyên tên, vị trí và nội dung.

| Task | Thiết kế / spec | Kế hoạch / checklist | Tài liệu kèm theo |
| --- | --- | --- | --- |
| S1 · Môi trường | [S1-moi-truong](specs/S1-moi-truong.md) | [S1-moi-truong](plans/S1-moi-truong.md) | [Kiểm tra local](plans/S1-kiem-tra.md), [câu hỏi kickoff/checkpoint](plans/S1-cau-hoi.md) |
| D1 · Database | [D1-database](specs/D1-database.md) | [D1-database](plans/D1-database.md) | [Quyết định](specs/D1-quyet-dinh.md), [ERD](specs/D1-erd.md), [kiểm tra local](plans/D1-kiem-tra.md) |
| D1/B1/B2/F2 · Tuần 02 | [D1-B1-B2-F2-tuan-02](specs/D1-B1-B2-F2-tuan-02.md) | [D1-B1-B2-F2-tuan-02](plans/D1-B1-B2-F2-tuan-02.md) | Sẵn sàng PR; còn CI/review/staging |
| B5 · Notifications | [Thiết kế B5](specs/2026-11-13-b5-notifications-design.md) | [Kế hoạch B5](plans/2026-11-13-b5-notifications.md) | Inbox, publisher và reminder 24 giờ đã hiện thực |
| B6 · Comment | [B6-comment](specs/B6-comment.md) | [B6-comment](plans/B6-comment.md) | Đã merge dev; I2b xác nhận F6 thảo luận chung local, chưa staging |
| I2a · Tích hợp Thông báo | [Spec](specs/I2a-thong-bao.md) | [Plan/evidence](plans/I2a-thong-bao.md) | Local API/UI đạt; chưa deploy |
| I2b · Tích hợp Comment | [Spec](specs/I2b-comment.md) | [Plan/evidence](plans/I2b-comment.md) | Local UI/API đạt; deploy package sẵn, chưa deploy |
| T4 · System regression | [Spec](specs/T4-system-test.md) | [Plan/evidence](plans/T4-system-test.md) | Sửa QA và regression local; chờ staging, CI/review độc lập |
## Cách đọc và cập nhật

- Đặt tên ngắn theo `<mã task>-<tên>.md`, ví dụ `S1-moi-truong.md`,
  `D1-database.md`. Không thêm ngày hoặc tên người vào tên file. Phạm vi chung
  nhiều task của Long ghép các mã, ví dụ `D1-B1-B2-F2-tuan-02.md`.
- `specs/`: yêu cầu, thiết kế, quyết định kỹ thuật và chú thích ERD.
- `plans/`: kế hoạch, checklist, câu hỏi cần chốt và kết quả kiểm tra. Cặp
  spec/plan chính dùng cùng tên; tài liệu kèm theo vẫn bắt đầu bằng mã task.
- Ngày, chủ sở hữu và trạng thái được ghi trong nội dung. Các bản kiểm tra
  S1/D1 cũ giữ nguyên ngày và kết quả lịch sử; không coi đó là kiểm tra lại hôm nay.
- Cập nhật trạng thái trong plan; spec chỉ đổi khi yêu cầu/thiết kế đổi. README
  repo trỏ về cặp tài liệu thay vì tạo thêm bản bàn giao hoặc progress report.
- Checkbox hoàn thành phải có evidence phù hợp. Phân biệt local verified,
  CI, review và staging acceptance; không dùng một trạng thái thay cho trạng thái khác.
- OpenAPI và các quyết định nghiệp vụ hiện có vẫn là nguồn chuyên môn dùng chung;
  spec/plan liên kết tới chúng, không tạo bản contract độc lập.
- D2/OpenAPI thuộc Nam. Long ghi đề xuất ảnh hưởng B1/B2 vào spec/plan của mình
  để bàn giao; không trực tiếp sửa file task của Nam.
- Giữ [migration runbook](../../database/migrations/README.md), mã nguồn ERD và
  OpenAPI ở vị trí kỹ thuật hiện tại; các tài liệu task liên kết tới nguồn đó.

Spec tuần 02 được quản lý trong repo backend và có phần frontend phụ thuộc. Khi
checkout hai repo cạnh nhau, README frontend trỏ tới cùng tài liệu; khi mở PR,
đính kèm liên kết commit/PR tương ứng của cả hai repo để reviewer truy vết.
