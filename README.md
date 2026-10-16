# TubeScope

Ứng dụng thật để tìm metadata YouTube bằng **yt-dlp**, chọn video và lưu vào **SQLite**. Giao diện **Next.js/React + shadcn/ui**, backend **Python/FastAPI**. Dữ liệu không phải dữ liệu mock.

## Chạy trên máy

Cần Python 3.11+, Node.js 22+ và [uv](https://docs.astral.sh/uv/getting-started/installation/).

```bash
./run.sh
```

Lần đầu chương trình cài dependency đã khóa phiên bản. Mở [TubeScope](http://localhost:3000). Nhấn **Ctrl+C** ở terminal để dừng cả frontend và backend.

```bash
# Sau khi đã cài dependency
./run.sh --skip-install

# Build và chạy frontend ở production mode
./run.sh --production

# Đổi cổng nếu đang bị chiếm
./run.sh --port 3100 --api-port 8766
```

Ứng dụng mặc định chỉ lắng nghe `127.0.0.1`, dành cho sử dụng cá nhân trên máy. Chưa tích hợp đăng nhập hay triển khai cho nhiều người dùng.

## Quy trình

1. Chọn nguồn: từ khóa, kênh/tab kênh, playlist, video/Shorts hoặc link tìm kiếm YouTube. Mỗi dòng một nguồn.
2. Chọn giới hạn và bộ lọc tùy chọn. Mặc định 100 kết quả mỗi nguồn **trước khi lọc**, lấy metadata chi tiết.
3. Chạy tác vụ; xem tiến trình, kết quả mới/đã lưu và lỗi cụ thể. Có thể dừng, giữ kết quả đã xử lý và thử lại tác vụ lỗi.
4. Chọn video để lưu kho. Nếu dùng chế độ sơ bộ, bước lưu cần bổ sung metadata chi tiết.
5. Duyệt kho theo **Kênh / Playlist / Category / Tất cả video**. Review từng video, ghi chú và thêm thẻ riêng.
6. Cập nhật metadata không làm mất review. Xuất CSV theo phạm vi/bộ lọc hoặc các video đang chọn.

## Dữ liệu lưu

17 nhóm: ID/link video; tiêu đề; tên/ID/link/handle kênh; link thumbnail; thời lượng; lượt xem; ngày đăng; loại nội dung/trạng thái live; Category YouTube; mô tả; tags gốc; lượt thích; số người đăng ký; dấu xác minh; giấy phép; chương; danh sách ngôn ngữ phụ đề.

Không lưu số/nội dung bình luận, nội dung phụ đề, heatmap, danh sách định dạng/codec/bitrate/FPS hoặc file ảnh/video/audio/phụ đề. Thumbnail được trình duyệt hiển thị trực tiếp từ URL nguồn, không được backend tải về lưu kho. Trường thiếu giữ `null`, giao diện hiển thị “—”.

Kho nằm tại `backend/data/tubescope.sqlite3`. SQLite dùng WAL, index và FTS5; video ID duy nhất và quan hệ playlist nhiều-nhiều. Giao diện chỉ nhận từng trang, không tải toàn bộ kho vào bộ nhớ trình duyệt. Đã đo truy vấn với 100.000 hàng tổng hợp trong database tạm; chưa cào 100.000 video từ mạng YouTube để kiểm chứng.

Để sao lưu, dừng ứng dụng rồi sao chép file SQLite; khi ứng dụng đang chạy dùng SQLite backup API thay vì chỉ chép file chính có WAL. Có thể đặt biến `TUBESCOPE_DB` để đổi vị trí dữ liệu. `.env.example` mô tả các biến; nếu dùng file `.env` hãy export biến vào shell trước khi chạy.

Danh mục Category là danh sách lưu sẵn có cả ID lịch sử, không phải kết quả API hiện hành theo khu vực. yt-dlp trả về tên category; video thiếu thể loại vào “Chưa xác định”. Một playlist chỉ xuất hiện trong kho sau khi đã ghi nhận quan hệ từ nguồn playlist được cào; không tự tìm mọi playlist chứa video.

## Kiểm tra

```bash
cd backend
uv run pytest

cd ../frontend
npm run build
npm run lint
npm run typecheck
npm test

# Từ thư mục gốc, khi server đang chạy: cào mẫu nhỏ thật,
# lưu video, kiểm tra review/cập nhật/CSV và ghi bằng chứng.
cd ..
python scripts/smoke.py

# Kiểm tra vòng đời launcher (không cần server)
python -m pytest tests/test_launcher.py

# Chromium headless: thao tác thật, lưu/review, CSV, mobile và axe.
# Lần đầu cần cài Chromium cho Playwright:
uv run --with playwright python -m playwright install chromium
uv run --with playwright python scripts/browser_check.py

# Dùng lại lượt cào đã có khi kiểm tra giao diện lần nữa:
uv run --with playwright python scripts/browser_check.py --job JOB_ID

# Đo SQLite bằng dữ liệu tổng hợp trong DB tạm; không đụng kho thật:
cd backend
uv run python ../scripts/benchmark_sqlite.py
```

Kiểm tra mạng thật sẽ lưu một số video YouTube thật vào kho; không tạo hàng dữ liệu giả. Bài kiểm tra khôi phục ghi chú/trạng thái review về giá trị trước đó.

API tương tác: [Swagger](http://127.0.0.1:8765/docs). Hợp đồng dữ liệu và phạm vi: `docs/api-contract.md`, `docs/spec.md`.

## Giới hạn vận hành

YouTube có thể đổi giao diện, giới hạn tần suất hoặc yêu cầu xác minh; ứng dụng hiển thị lỗi thật và không thay bằng dữ liệu mẫu. Tốc độ phụ thuộc nguồn, lượng ứng viên, bộ lọc và mạng. Không cấu hình cookie/tài khoản trong phiên bản này. Tác vụ đang chạy khi backend dừng sẽ được đánh dấu gián đoạn khi khởi động lại; không báo hoàn tất giả.
