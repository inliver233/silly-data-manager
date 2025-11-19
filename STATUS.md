# 云酒馆数据上传系统 · 当前实现状态（2025‑11‑19）

本文件用于记录 `dmsystem/` 下云酒馆数据上传系统的当前实现情况、已知问题和后续工作，方便后续开发者或新的对话上下文快速接手。

## 1. 总体架构

- 主站（SillyTavernchat）：
  - 仍然使用 `server.js` + `src/`，数据根目录 DATA_ROOT 在生产为 `/root/SillyTavernchat/data`。
  - 云酒馆上传系统 **不修改** `_storage`、`system-monitor`、`forum_data` 等全局目录，只操作 `DATA_ROOT/{handle}`。

- 上传系统（本目录 `dmsystem/`）：
  - 独立 Node.js + Express 服务，端口默认 `23669`。
  - 环境变量：
    - `DATA_ROOT`：SillyTavernchat 数据根目录（生产为 `/root/SillyTavernchat/data`）。
    - `DMSYSTEM_TEMP_ROOT`：上传系统临时根（推荐 `/root/dmsystem/temp`）。
    - LinuxDo OAuth：`LINUXDO_CLIENT_ID` / `LINUXDO_CLIENT_SECRET` / `LINUXDO_REDIRECT_URI`。
    - 管理端：`ADMIN_USERNAME` / `ADMIN_PASSWORD` / `SESSION_SECRET`。

- TEMP_ROOT 结构（以 LinuxDo 用户名分隔）：
  - `TEMP_ROOT/{linuxdoUser}/uploads/`：上传过程中保存的 data.zip。
  - `TEMP_ROOT/{linuxdoUser}/extract/`：zip 解压后的工作目录。
  - `TEMP_ROOT/{linuxdoUser}/backups/{handle}/upload_*.zip`：每次真实写入前自动生成的上传前备份 zip。

## 2. 已实现功能

### 2.1 登录和 handle 映射

- LinuxDo OAuth2 登录流程：
  - `/api/auth/login` → 重定向到 LinuxDo 授权端点。
  - `/oauth` → 使用 code 换 token，再获取用户信息。
  - 会话中保存：
    - `linuxdo`：`id` / `username` / `name` / `trust_level` / `active` / `silenced`。
    - `stHandle`：默认 `normalizeHandle(linuxdo.username)`。
- 用户可通过 `/api/auth/handle` 手动指定 SillyTavern handle：
  - 后端使用与主项目一致的 `normalizeHandle` 规范化；
  - 检查 `DATA_ROOT/{handle}` 是否存在；
  - 成功后将 `stHandle` 切换为该 handle；
  - 写入 `type: 'handle-change'` 日志（记录 from/to/rawHandle、IP、User-Agent）。

### 2.2 数据状态 `/api/data/status`

- 根据当前 `stHandle` 定位 `DATA_ROOT/{handle}`，返回：
  - `exists` / `path` / `size` / `mtime`；
  - `keyFiles`：`settings.json`、`secrets.json`、`stats.json`、`content.log` 是否存在；
  - `lastUpload`：最近一次成功“真实写入”上传的记录（来自 `_upload_service/state.json`）；
  - `rollback`：
    - `canRollback`：是否存在可用的上传前备份；
    - `backupPath` / `backupSize` / `backupMtime`；
    - `uploadTimestamp`。
- 前端首页会将这些信息渲染为摘要文本，并保留原始 JSON 供技术查看。

### 2.3 上传 `/api/data/upload`

- 请求：
  - `multipart/form-data`，字段名 `dataZip`，大小 ≤ 100MB。
  - 可选字段：
    - `simulate`：`true` / `false`（模拟 or 真实写入）。
    - `overwriteSettings` / `overwriteSecrets` / `overwriteStats` / `overwriteContentLog`：是否覆盖对应的 root 文件（仅真实写入模式有意义）。

- 解压与结构识别：
  - 解压到 `TEMP_ROOT/{linuxdoUser}/extract/{timestamp}_extracted/`：
    - 检查路径防止 Zip Slip；
    - 解压后总大小限制为 500MB。
  - 支持以下结构：
    1. **用户根目录（user_root）**：
       - 根下有 `settings.json`，且存在 `characters/` / `chats/` / `backups/` 中至少一个目录；
       - 视为单个用户目录备份。
    2. **完整 data 目录（data_dir）**：
       - `extractRoot/data` 存在。
       - 优先寻找 `data/{currentHandle}`，如不存在：
         - 忽略 `_cache` / `_storage` / `_uploads` / `_webpack` / `system-monitor` / `forum_data` / `public_characters` / `announcements` 等系统目录；
         - 在剩余目录中寻找“唯一看起来像用户目录”的子目录（满足 user_root 判定），作为源 `sourceUserRoot`，并记录 `sourceHandle`（例如 `default-user`）。
       - 若找到多个候选用户目录且都不是当前 handle，则报错提示。

- 安全校验：
  - 遍历 `sourceUserRoot` 下所有文件：
    - 若扩展名命中主项目的 `UNSAFE_EXTENSIONS` 列表（`.exe` / `.bat` / `.js` / `.py` / `.html` / `.pdf` 等），计入 `unsafeFiles`。
  - 若存在 `unsafeFiles`：
    - 模拟模式：返回 `simulation.canProceed = false`，不写任何数据；
    - 真实写入模式：直接拒绝上传，返回 JSON 错误，不修改 DATA_ROOT。
  - 解压后总大小 > 500MB 时，同样拒绝。

- 模拟模式（`simulate=true`）：
  - 不写入 DATA_ROOT，不创建备份；
  - 返回结构包括：
    - `structure` / `sourceHandle` / `sourceUserRoot`；
    - `unsafeFiles`；
    - `approximateUncompressedSize`；
    - `canProceed` 布尔。
  - 写日志：`type: 'upload-simulate'`。

- 真实写入模式（`simulate=false`）：
  1. 检查 `DATA_ROOT/{handle}` 是否存在，不存在则报错；
  2. 在 **写入任何数据前**：
     - 把 `DATA_ROOT/{handle}` 打包为 zip：
       - 位置：`TEMP_ROOT/{linuxdoUser}/backups/{handle}/upload_{timestamp}.zip`；
       - 用于后续一键回滚；
  3. 目录合并：
     - 对 `MERGE_DIRECTORIES` 列表中的目录（characters/chats/worlds/QuickReplies/…）执行 `fs.cpSync(source, target, { recursive: true, force: true })`；
     - 未出现在上传包中的旧数据不会被删除。
  4. 根文件覆盖（根据前端复选框）：
     - 支持覆盖 `settings.json` / `secrets.json` / `stats.json` / `content.log`。
  5. 更新 `_upload_service/state.json` 的 `lastUpload`，并记录 `backupZipPath` 和 `mergeResult`；
  6. 写 `type: 'upload'` 日志；
  7. 在 `finally` 中清理解压目录和上传缓存 zip。

### 2.4 回滚 `/api/data/rollback`

- 前提：存在 `lastUpload.backupZipPath`，且该文件仍存在。
- 步骤：
  1. 将当前 `DATA_ROOT/{handle}` 重命名为 `DATA_ROOT/{handle}__failed_{timestamp}`；
  2. 从 `backupZipPath` 解压出新的 `DATA_ROOT/{handle}`；
  3. 写 `type: 'rollback'` 日志。
- 若无可用备份，则返回错误；前端状态摘要中会显示“当前没有可用的自动备份（尚未通过本系统进行成功上传）”，按钮会禁用。

### 2.5 自动备份列表与清理 `/api/data/backups`

- `getUploadBackups(handle, linuxdoUser, maxAgeMs = 24h)`：
  - 枚举 `TEMP_ROOT/{user}/backups/{handle}/upload_*.zip`；
  - 删除超过 `maxAgeMs` 的备份；
  - 返回剩余备份的名称、路径、大小、mtime，并按时间倒序排序。
- `GET /api/data/backups`：
  - 返回 `{ ok: true, backups: [...] }`；
  - 当前前端尚未消费此接口（下一步可以用来做备份管理 UI）。

### 2.6 管理端与日志

- 日志文件：`DATA_ROOT/_upload_service/logs/{YYYY-MM}.log`，每行一个 JSON，type 可能是：
  - `login`：LinuxDo 登录；
  - `handle-change`：用户在前端切换 handle；
  - `upload-simulate`：模拟上传；
  - `upload`：真实写入（目前在生产环境尚未成功落地）；
  - `rollback`：回滚。
- `/admin` 管理前端：
  - 登录：`/admin/api/login`（返回 `csrfToken` 存入 session），后续所有 `/admin/api/*` 都要求带 `X-CSRF-Token`；
  - 用户列表：`/admin/api/users`：
    - 按 LinuxDo 用户（id 或 username）聚合日志；
    - 统计该用户出现过的所有 handles、首次/最后时间、登录/上传/回滚/handle 切换次数；
    - 管理界面按行展示，点击一行会显示“选中用户概览”。
  - 日志查询：`/admin/api/logs`：
    - 支持按 `type`、`handle`、`linuxdoId`、`linuxdoUsername`、`limit` 过滤；
    - 前端会自动带上选中用户的 linuxdoId/username，并可选填 handle/type，查看单个用户的详细行为记录。

## 3. 已知问题 / 待解决事项

1. **真实写入上传在生产环境尚未成功**
   - 目前在生产日志中只看到 `upload-simulate`，没有任何 `upload` 记录；
   - 说明真实上传请求没有顺利进入 `processUpload` 完成合并（怀疑被 Nginx/反代拦截或超时，返回 HTML 错误页）。
   - 前端已改为 XHR + 手动 JSON 解析，在遇到 HTML 响应时会打印出“服务器响应不是 JSON（状态 XXX）”以及完整 HTML 内容；但尚未根据这一信息更新 Nginx/反代配置。

2. **上传 UI 仍可继续优化**
   - 目前有文本形式的进度（百分比 + MB），但没有图形进度条；
   - 上传时仅在一个 `<pre>` 中展示日志，可以考虑拆分为更结构化的卡片或表格，改进可读性。

3. **备份管理 UI 尚未完成**
   - 后端已有 `/api/data/backups`，会列出最近的上传前备份并顺带清理过期的；
   - 但用户目前只能通过“一键回滚”使用“最近一次上传前备份”，没有“列出 / 下载 / 删除某个自动备份”的界面。

4. **文档同步仍不完全**
   - `data上传系统技术报告.md` 仍然以设计为主，需要补充当前实际实现的说明；
   - TEMP_ROOT 与 DATA_ROOT 的现状、日志结构、已知生产问题（真实写入失败）的描述需要整理进文档。

## 4. 下一步建议工作（给后续开发者）

1. 利用当前前端 XHR 日志，找到真实上传失败时服务器返回的 HTML 错误内容，定位 Nginx/反代配置问题（可能是 body 限制或超时），并更新文档说明。
2. 优化上传 UI：
   - 进一步美化进度展示（进度条、禁用按钮、错误提示颜色等）；
   - 确保模拟与真实写入模式界面上的差异明确。
3. 基于 `/api/data/backups` 实现备份列表 UI，包括下载与删除操作，明确这些备份是“上传前快照”而非 SillyTavern 内置备份。
4. 更新 `data上传系统技术报告.md`，将此 `STATUS.md` 的内容（或精简版）合入文档开头的“实施状态说明”章节。

