# Codex Task Queue

File này là nơi người dùng nhập task thô để Codex Automation xử lý lần lượt.

## User Input

Chỉ nhập task theo đúng cấu trúc bên dưới. Mỗi dòng là một task độc lập.

```md
- task 1: <mô tả task cần làm>
- task 2: <mô tả task cần làm>
- task 3: <mô tả task cần làm>
```

## Tasks

- task 1: chỉnh sửa phần card: bỏ hiển thị ip ở ngoài card chính, bỏ hiển thị khu vực bên trong card, vì có sort theo khu vực rồi, về các con số, hiện tại đang hiển thị cả 3 trục và nhiệt độ, sửa lại là hiển thị nhiệt độ, còn 3 trục, kiểm tra xem trong khu vực đó, thiết bị nào có một trong 3 trục có giá trị lớn nhất thì hiển thị trong thiết bị đó thôi.
- task 2: chỉnh sửa lại các biểu đồ bên trong hiển thị dữ liệu, chỉnh sửa các phần sau: biểu đồ phổ, trục y không hiển thị đơn vị m/s2 nữa, chuyển sang normalize cho tôi, trục y hiển thị từ 0 tới 100 biểu diễn cho tỉ lệ phần trăm. biểu đồ nhiệt độ: cố định giá trị trục y từ 20 tới 120 độ cho tôi. biểu đồ trend, trục y cố định từ 0 tới 16m/s2 ở rms, -16 tới 16 cho tức thời, bỏ không có tự thay đổi trục y theo dữ liệu nữa, giờ đây khi chuột tôi ở phần trục y, tôi scroll thì nó mới được thay đổi giá trị của trục y tăng hoặc giảm.
- task 3: chỉnh sửa modal hiển thị dữ liêụ, tôi muốn chuyển đôỉ dùng sidebar phải, thay vì dùng modal như hiện tại, khi bấm vào một thiết bị, side bar phía bên phải sẽ slide qua, các thiết bị sẽ được đẩy xuống thay vì bị che khuất

## Automation Rules

Codex Automation phải tuân thủ các quy tắc sau khi đọc file này:

1. Chỉ xử lý đúng 1 task trong mỗi lần chạy automation.
2. Luôn chọn task đầu tiên còn nội dung và chưa có kết quả hoàn thành tương ứng.
3. Không gộp nhiều task vào cùng một request, cùng một plan, hoặc cùng một lần chỉnh sửa.
4. Trước khi chỉnh sửa code, phải phân tích task và viết lại yêu cầu rõ ràng hơn vào file `codex_task_requirements.md`.
5. File `codex_task_requirements.md` phải có tối thiểu:
   - task id
   - nội dung gốc từ người dùng
   - yêu cầu đã được viết lại rõ ràng
   - phạm vi thực hiện
   - giả định nếu có
   - acceptance criteria
   - kế hoạch thực hiện ngắn gọn
   - rủi ro hoặc blocker nếu có
6. Sau khi ghi requirement, automation chỉ được thực hiện task đang được chọn.
7. Không sửa code ngoài phạm vi task đang xử lý.
8. Không commit, push, deploy, hoặc tạo PR trừ khi người dùng yêu cầu riêng.
9. Sau khi thực hiện xong, phải ghi kết quả thật vào file `codex_task_results.md`.
10. File `codex_task_results.md` phải có tối thiểu:
    - task id
    - thời gian thực hiện
    - trạng thái: `done`, `blocked`, hoặc `failed`
    - file đã chỉnh sửa
    - lệnh đã chạy
    - kết quả kiểm tra/test
    - phần còn cần người dùng quyết định nếu có
11. Nếu task chưa đủ thông tin để thực hiện an toàn, automation phải đánh dấu `blocked` trong `codex_task_results.md` và không tự đoán quá mức.

## Output Files

Automation sẽ tạo hoặc cập nhật các file sau:

- `codex_task_requirements.md`: yêu cầu đã được phân tích và viết lại rõ ràng.
- `codex_task_results.md`: kết quả thực hiện thực tế sau khi xử lý task.
