# Architecture refactor roadmap

Roadmap này lưu lại các sprint tối ưu kiến trúc sau khi review flow trong `docs/architecture/README.md`.

## Sprint 1 — Simplify HTTP architecture

Status: completed.

- Tách `server/src/modules/http/register-routes.ts` theo bounded context: auth/ops, OTA, zone, device, alert.
- Loại bỏ `fleet` và `governance` khỏi hệ thống để giảm workflow không cần thiết.
- Giữ OTA direct dispatch qua `/api/ota/*`, không còn rollout module.
- Giữ nguyên API contract, response shape và service behavior.
- Mục tiêu: giảm file 3k+ dòng, dễ tìm endpoint, dễ test từng nhóm route.

Progress:

- Đã tách nhóm core/platform routes sang `server/src/modules/http/core.routes.ts`: app shell, `/health`, `/api/auth/me`, `/socket-info`.
- Đã loại bỏ governance và fleet khỏi source; OTA chuyển sang direct device targeting.
- Đã xoá `/api/fleet/*` và `/api/governance/*`; route inventory giảm từ 80 xuống 59.
- Đã xoá `incident` và `observability`; giữ basic `/health` trong core routes và dùng no-op metrics nội bộ.
- Đã xoá rollout module/routes; OTA còn direct dispatch dưới `/api/ota/*`.
- Đã xoá wiring `FleetService`/`GovernanceService` khỏi `server/src/index.ts`.
- Đã giữ nguyên `registerRoutes` làm facade để các caller hiện tại không đổi.
- Đã chạy `pnpm -C server typecheck` và `pnpm -C server test` pass.

## Sprint 2 — Split realtime socket handlers

Status: completed.

- Tách `server/src/modules/realtime/socket.handlers.ts` thành handler nhỏ: session/auth, heartbeat/metadata, telemetry ingest, spectrum ingest, command ack.
- Đưa logic orchestration nóng vào usecase/service nhỏ thay vì để socket callback ôm hết.
- Mục tiêu: giảm coupling giữa Socket.IO transport và domain flow.

Progress:

- Đã giữ `server/src/modules/realtime/socket.handlers.ts` làm facade đăng ký connection và route sang các handler nhỏ.
- Đã tách session/auth/disconnect sang `session.handlers.ts`.
- Đã tách heartbeat và metadata sang `device-state.handlers.ts`.
- Đã tách telemetry ingest/alert broadcast sang `telemetry-ingest.handlers.ts`.
- Đã tách spectrum ingest sang `spectrum-ingest.handlers.ts` và normalization thuần sang `spectrum-message.normalizer.ts`.
- Đã tách command ack/request-last-command sang `command.handlers.ts`.
- Đã chạy `pnpm -C server typecheck` và `pnpm -C server test` pass.

## Sprint 3 — Refactor large frontend components

Status: completed.

- Tách `SensorChartModal.tsx` thành hooks/data transforms/chart panels/modal state.
- Giữ nguyên UI behavior trước, sau đó mới tối ưu render/performance.
- Mục tiêu: giảm component 5k+ dòng, tăng khả năng test và chỉnh chart.

Progress:

- Đã giữ nguyên public import `./SensorChartModal` cho `DeviceManagement` và lazy loading hiện tại.
- Đã tách chart constants, formatters, data transforms, trend/spectrum chart panels sang `server/client/src/app/components/sensor-chart-modal/chart-parts.tsx`.
- Đã tách layout resize state/effect sang hook `server/client/src/app/components/sensor-chart-modal/useChartModalLayout.ts`.
- `SensorChartModal.tsx` giảm từ ~5.8k dòng xuống ~3k dòng, tập trung hơn vào modal orchestration/state và JSX shell.
- Đã chạy `pnpm -C server/client typecheck` và `pnpm -C server/client build` pass.

## Sprint 4 — Normalize persistence policy

Status: completed.

- Xác định rõ demo/in-memory mode và production/persistent mode.
- Ưu tiên command state không mất sau restart nếu chạy production.
- Mục tiêu: tránh trạng thái runtime quan trọng bị volatile ngoài ý muốn.

Progress:

- Đã xác định rõ mode trong README: không có MySQL là demo/in-memory, production/persistent cần MySQL.
- Đã thêm bảng MySQL `device_commands` vào bootstrap schema để lưu command state, timeout và ack history.
- Đã thêm `MySqlCommandRepository` hydrate từ MySQL lúc boot và await persist `save/update` trước khi HTTP route xác nhận hoặc realtime ack/timeout đổi state.
- Đã đổi wiring server: có MySQL thì dùng command repository bền vững, không có MySQL thì fallback `InMemoryCommandRepository`.
- Server startup log giờ có `persistenceMode` để nhìn nhanh mode runtime.
- Đã chạy `pnpm -C server typecheck` và `pnpm -C server test` pass.

## Sprint 5 — Cleanup generated candidates

Status: completed.

- Dọn các mục chắc chắn từ `docs/architecture/generated/knip.txt`.
- Review kỹ public exports/config hints trước khi xoá.
- Mục tiêu: giảm dependency/file nhiễu và làm architecture graph gọn hơn.

Progress:

- Đã xoá các unused files chắc chắn: legacy `app.css`, `fonts.css`, empty `postcss.config.mjs`, telemetry in-memory/file persistence cũ không còn được wire.
- Đã gỡ unused dependencies: `echarts`, `recharts`, `ioredis`, `pino`, server-side `socket.io-client`.
- Đã thêm `python3` vào `ignoreBinaries` vì root scripts chủ động gọi binary hệ thống này.
- Đã regenerate architecture artifacts bằng `pnpm arch:generate`; `knip` hiện chỉ còn public export/type review items và config hints.
- Đã chạy `pnpm typecheck`, `pnpm test`, và `pnpm build` pass.

## Sprint 6 — Reduce public surface noise

Status: completed.

- Review các public export/type/config hint còn lại từ `knip` sau Sprint 5.
- Chỉ giữ public surface cho runtime entrypoint đang dùng; chuyển helper/type nội bộ về file-local.
- Chuẩn hoá `knip.json` theo pnpm workspace để tránh false positive từ top-level pattern cũ.
- Mục tiêu: làm báo cáo cleanup sạch hơn mà không đổi REST/socket contract hay UI behavior.

Progress:

- Đã loại bỏ các barrel export dư trong `server/src/modules/auth/index.ts`, chỉ giữ `AuthService` và `createAuthServiceFromEnv` đang được import qua module boundary.
- Đã chuyển helper/type nội bộ của auth, theme, button, sensor data, audit, device, realtime, spectrum, zone và config từ exported sang file-local.
- Đã xoá type `DeviceClientType` không còn được dùng.
- Đã chuyển `knip.json` sang cấu hình `workspaces` cho root, `server` và `server/client`; giữ ignore dependency rõ ràng cho binary/CSS-only usage.
- `pnpm exec knip --config knip.json --no-exit-code` hiện không còn findings.
