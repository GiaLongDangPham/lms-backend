# D1 · Checklist và bàn giao

[Spec database](../specs/D1-database.md) · [Quyết định](../specs/D1-quyet-dinh.md) ·
[ERD](../specs/D1-erd.md) · [Kết quả kiểm tra](D1-kiem-tra.md).

Long · baseline 14–15/10/2026, 8 giờ · CP1 ngày 15/10.
Chuẩn bị sớm ngày 11/10 không có nghĩa D1/S1 đã hoàn thành hoặc đã tiêu hết 8 giờ.

## Đã chuẩn bị trong nhánh D1-setup-database

- [x] Đối chiếu Client Log, phạm vi và yêu cầu DB Schema trong ba PDF.
- [x] Lập bảng thực thể/dữ liệu/quan hệ và từ điển dữ liệu nháp.
- [x] Dựng ERD nháp cho chín thực thể chính và các bảng phụ.
- [x] Ghi rõ ràng buộc liên bảng, phân quyền và điểm Draft không được lộ.
- [x] Lập câu hỏi/nhật ký quyết định Q01–Q10.
- [x] Lập kế hoạch seed và nghiệm thu migration.

## Đầu vào và quyết định còn mở

- [ ] Xem prototype R1 của Cát/Kha; cập nhật schema khi có khác biệt.
- [ ] Đối chiếu OpenAPI/mock D2 với Nam; ID, enum, tên và trường khớp.
- [x] Long chốt đăng nhập mã trường (Q01), UUID (Q02), SQL + pg (Q03).
- [ ] Review phần còn lại Q01 và Q04 với Nam/Kha; đồng bộ D2.
- [ ] Chốt các quyết định Q05–Q10 có ảnh hưởng schema; ghi rõ phần để CP2.
- [ ] Nam/Khang review ERD và dữ liệu bàn giao; sửa theo góp ý.

## Công việc ngày 14/10 · dự kiến 4 giờ

1. Review R1/yêu cầu và các câu hỏi nghiệp vụ.
2. Thống nhất tên thực thể, ID, timestamp và trạng thái với Nam.
3. Hoàn thiện ERD, từ điển dữ liệu, khóa/FK/UNIQUE/CHECK và chính sách xóa.
4. Chọn công cụ migration; đưa bản thiết kế vào PR để review sớm.

## Công việc ngày 15/10 · dự kiến 4 giờ

1. Viết migration đã có phiên bản và lệnh chạy rõ ràng.
2. Chuẩn bị seed giả lập để Nam làm B3 mà không phải chờ B1.
3. Chạy migration trên DB thử trống; kiểm tra chạy lại và ràng buộc quan trọng.
4. Sửa theo CP1; cập nhật README, PR và issue D1 bằng kết quả thật.

## DoD trước khi đóng issue D1

- [x] Có ERD nháp và migration SQL trong working tree của nhánh D1.
- [ ] ERD cuối và script migration được commit/review.
- [ ] Review 3NF, phụ thuộc hàm, FK và ràng buộc không trùng dữ liệu.
- [x] Migration chạy trên database thử trống, chạy lại không trùng và rollback khi lỗi.
- [x] Seed local/hướng dẫn được chuẩn bị; metadata giả được phân biệt với file thật.
- [ ] Nam tự chạy migration/seed và xác nhận đủ dữ liệu cho B3.
- [ ] DB, API spec và prototype/wireframe khớp tại CP1, có biên bản duyệt.
- [ ] PR backend của Long được Nam review; CI đạt.
- [ ] Issue D1 có link PR/ERD/spec, các quyết định và bằng chứng kiểm tra.

Không đánh dấu D1 Done chỉ vì ERD đã vẽ. Rule nộp lại/Late còn mở phải được theo dõi
đến CP2, trước B3; thay đổi schema sau CP1 cần ghi lại và phối hợp Nam.

## PR và Tracker

- Nhánh hiện có: `D1-setup-database`; giữ nhánh này để tiếp tục.
- Commit tài liệu gợi ý: `[D1] Draft database entities, ERD, and design decisions`.
- PR hiện tại là bản thiết kế từng phần: dùng `Refs #<issue-D1>`; chưa dùng Closes.
- Long ghi Timesheet đúng ngày/giờ thực tế với mã D1; không tự ghi 8 giờ kế hoạch
  thành giờ thực tế và không sửa Baseline.

Tài liệu: [thiết kế](../specs/D1-database.md) · [ERD](../specs/D1-erd.md) ·
[quyết định](../specs/D1-quyet-dinh.md) · [kết quả kiểm tra](D1-kiem-tra.md).
Sau D1/CP1, chuyển sang B1 ngày 16–20/10.
