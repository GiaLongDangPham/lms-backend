# Cấu trúc module nghiệp vụ

Tạo thư mục theo module: `auth`, `users`, `classes`, `materials`, `assignments`,
`submissions`, `grades`, `notifications`, `comments` khi bắt đầu hoạt động tương ứng.

- `*.routes.ts`: đường dẫn, middleware auth/phân quyền, kiểm tra đầu vào.
- `*.controller.ts`: nhận request và trả response theo OpenAPI.
- `*.service.ts`: logic nghiệp vụ; kiểm tra quyền đối với lớp và tài nguyên.
- `*.repository.ts`: truy vấn PostgreSQL có tham số; tránh nối input vào SQL.

Đăng ký router trong `src/app.ts`, trước middleware 404. Không truy vấn DB trực tiếp
trong route. DB schema/migration thuộc D1; hợp đồng nghiệp vụ thuộc D2 do Nam soạn,
Long duyệt tại CP1. Khung hiện tại chỉ có endpoint hạ tầng của S1.
