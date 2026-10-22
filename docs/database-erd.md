# D1 · ERD cập nhật theo nghiệp vụ 17/10

Đối chiếu migration 0001–0003, D2 commit 532f983 và Client Log 18–20/L04/L05/L14/L20.
Có 16 bảng nghiệp vụ và 2 bảng auth; không vẽ bảng quản lý migration.
Xem [từ điển dữ liệu](database-design.md) và [quyết định](D1-decisions.md).

PK = khóa chính; FK = khóa ngoại; UK = khóa duy nhất. UUID đã được Long chốt Q02.
Migration `0003` bổ sung nghiệp vụ mới và giữ dữ liệu đã có từ 0001/0002.
ERD thể hiện cột chính và cardinality, không liệt kê toàn bộ audit fields/index.
Đường liền biểu thị quan hệ định danh, nét đứt biểu thị quan hệ không định danh;
cú pháp theo [tài liệu Mermaid ERD](https://mermaid.js.org/syntax/entityRelationshipDiagram.html).

Nguồn PlantUML để paste vào editor: [lms-erd.puml](../database/diagrams/lms-erd.puml).
Nguồn Mermaid: [lms-erd.mmd](../database/diagrams/lms-erd.mmd).
Bản xem/phóng to: [lms-erd.svg](../database/diagrams/lms-erd.svg).

Paste `.mmd` vào https://mermaid.live hoặc `.puml` vào editor PlantUML/draw.io có
hỗ trợ PlantUML. SVG được render local từ `.puml`; khi đổi schema cập nhật cả hai
nguồn và render lại SVG, không duy trì một bản code diagram nữa trong Markdown.

## Đọc phần nộp bài và điểm

Ví dụ SV A nộp bài X hai lần:

```text
submission S (assignment X + enrollment của SV A)
├── version 1 → file F1, F2
└── version 2 → file F3          ← bản hiện hành

grade (assignment X + enrollment SV A) → version được chấm
├── revision 1: Draft 8
├── revision 2: Published 8
└── revision 3: Published 9     ← kết quả hiện tại

SV B không nộp: grade (X + enrollment B) → 0 Published
submission_id = NULL; version = NULL; source = AUTO_ZERO_NO_SUBMISSION
```

Một Grade hiện tại/bài tập/ghi danh, nhiều snapshot lịch sử bất biến. Có grade thì
khóa nộp lại. SV chỉ xem snapshot Published. Sửa 0 tự động chuyển nguồn hiện tại
MANUAL, vẫn không tạo bài nộp; snapshot cũ giữ nguyên nguồn tự động.

## Ràng buộc không được bỏ sót khi chuyển thành SQL

1. UNIQUE `(class_id, student_id)` ở enrollments; PK class/teacher ở class_teachers.
2. UNIQUE `(assignment_id, enrollment_id)` ở submissions.
3. Lớp của assignment trùng lớp của enrollment: cần kiểm tra liên bảng, hai FK độc lập chưa đủ.
4. FK ghép của Grade và submission_files phải trỏ đúng `(submission_id, version_number)`.
5. Comment có đúng một target (assignment hoặc submission); quyền đọc theo Q09.
6. UNIQUE location/object_key của files; UNIQUE recipient/deduplication_key của notifications.
7. Cardinality nhiều file không có nghĩa một object được phép chia sẻ giữa các chủ sở hữu;
   quy tắc riêng này chốt ở Q08 và thực thi bằng service/DB.
8. Foreign key không thay thế kiểm tra role, quyền lớp và việc ẩn Grade Draft ở API.
9. UNIQUE `(course_code, code, term)` ở classes, `(assignment_id, enrollment_id)` ở grades.
10. Grade có thể không có submission/version; cả hai phải cùng NULL, chỉ Published
    được phép không có bài nộp. AUTO_ZERO_NO_SUBMISSION bắt buộc score = 0.
11. grade_history PK `(grade_id, version)`, cấm UPDATE/DELETE; trigger append snapshot.
12. Khóa assignment dùng chung cho nộp/chấm/công bố; công bố atomic trong service.
    DB chặn phiên bản mới nếu đã có grade hoặc assignment đã công bố.
