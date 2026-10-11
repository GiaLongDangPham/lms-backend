# D1 · ERD nháp để review

**Draft ngày 11/10/2026**, dựa trên yêu cầu trong PDF; chưa đối chiếu prototype R1
và OpenAPI D2. Xem [từ điển dữ liệu](database-design.md) và
[các quyết định cần chốt](D1-decisions.md) khi review nghiệp vụ.

PK = khóa chính; FK = khóa ngoại; UK = khóa duy nhất. UUID đã được Long chốt Q02.
Migration `0001` triển khai cấu trúc này cho local; nghiệp vụ vẫn cần CP1/CP2 review.
ERD thể hiện cột chính và cardinality, không liệt kê toàn bộ audit fields/index.
Đường liền biểu thị quan hệ định danh, nét đứt biểu thị quan hệ không định danh;
cú pháp theo [tài liệu Mermaid ERD](https://mermaid.js.org/syntax/entityRelationshipDiagram.html).

Sơ đồ chỉnh sửa: [lms-erd.mmd](../database/diagrams/lms-erd.mmd).
Bản xem/phóng to: [lms-erd.svg](../database/diagrams/lms-erd.svg).

Mở https://mermaid.live và dán nội dung file này vào ô Code để xem/chỉnh sửa.
File `.mmd` là nguồn sơ đồ; không duy trì bản Mermaid trùng lặp trong Markdown.
Khi sửa nguồn, xuất lại SVG từ Mermaid Live để hai bản khớp nhau.

## Đọc phần nộp bài và điểm

Ví dụ SV A nộp bài X hai lần:

```text
submission S (assignment X + enrollment của SV A)
├── version 1 → file F1, F2
└── version 2 → file F3          ← bản hiện hành

grade của S → ghi rõ chấm version 1 hay 2
```

Một Grade hiện tại/hồ sơ phù hợp yêu cầu không bắt buộc lịch sử mọi lần sửa điểm.
Giữ điểm thế nào nếu SV nộp lại sau chấm/công bố là Q06, không tự suy ra từ ERD.

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
