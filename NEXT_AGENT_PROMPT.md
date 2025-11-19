本文件是一段给“下一位助手 / 下一轮对话”的完整 prompt，用于快速理解当前云酒馆数据上传系统的实现状态和 TODO。

你正在接手一个基于 SillyTavernchat 的魔改仓库，其中 `dmsystem/` 目录下实现了一个独立的「云酒馆数据上传系统」。请在开始工作前，先阅读：

- 仓库根目录的 `AGENTS.md`（编码规范、不能修改的目录等）；
- 仓库根目录的 `data上传系统技术报告.md`（总体设计）；
- `dmsystem/STATUS.md`（当前实现状态与已知问题）；
- 再快速扫一遍：
  - `dmsystem/src/config.js`
  - `dmsystem/src/services/data-service.js`
  - `dmsystem/src/services/log-service.js`
  - `dmsystem/src/routes/*.js`
  - `dmsystem/public/index.html`, `dmsystem/public/main.js`
  - `dmsystem/public/admin.html`, `dmsystem/public/admin.js`

当前实现要点（简述）：

1. 主数据目录 DATA_ROOT 在生产环境为 `/root/SillyTavernchat/data`，云上传系统只操作 `DATA_ROOT/{handle}`，不碰 `_storage`、`system-monitor` 等。
2. 上传系统自己的临时根 TEMP_ROOT（建议 `/root/dmsystem/temp`），按 LinuxDo 用户划分子目录，管理上传缓存、解压目录、上传前自动备份：
   - `TEMP_ROOT/{linuxdoUser}/uploads/`：data.zip 缓存；
   - `TEMP_ROOT/{linuxdoUser}/extract/`：解压工作目录；
   - `TEMP_ROOT/{linuxdoUser}/backups/{handle}/upload_*.zip`：真实写入前打的完整备份。
3. LinuxDo OAuth 登录已经实现，session 中保存 `linuxdo` 信息和 `stHandle`（默认规范化自 LinuxDo 用户名）。用户可以通过 `/api/auth/handle` 手动指定要操作的 SillyTavern handle，后端会规范化并检查 `DATA_ROOT/{handle}` 是否存在。
4. `/api/data/status` 会返回当前 handle 的目录大小、关键文件存在状态、最近一次真实写入上传记录 `lastUpload`、以及是否存在可回滚的自动备份（`rollback.canRollback` 等）。
5. `/api/data/upload` 已经支持：
   - 模拟模式：只解压 + 结构识别 + 安全检查，不写入数据，写 `upload-simulate` 日志；
   - 真实写入模式：在写入前将 `DATA_ROOT/{handle}` 打包到 TEMP_ROOT 作为 `upload_*.zip`，然后按目录合并 + key 文件覆盖策略写入，更新 `lastUpload` 和日志，并清除临时文件。
   - 结构识别支持：单用户根目录（user_root）和完整 `data/` 目录（自动识别唯一用户目录）；安全检查使用主项目的 `UNSAFE_EXTENSIONS`。
6. `/api/data/rollback` 会根据 `lastUpload.backupZipPath` 将 `DATA_ROOT/{handle}` 一键恢复到最近一次真实写入上传之前的状态。
7. 管理端 `/admin` 已经实现登录 + CSRF 保护，`/admin/api/users` 可以按 LinuxDo 用户聚合日志，统计该用户所有 handles、登录/上传/回滚/handle 切换次数；`/admin/api/logs` 可以按 type/handle/linuxdoId/linuxdoUsername 过滤日志。
8. 用户前端页面 `/` 已有比较完整的 UI：登录状态、当前 handle、手动切换 handle、数据状态摘要、上传（模拟/真实）、文本形式的上传进度（百分比）、一键回滚等。

当前最重要的未解决问题：

1. 在生产环境，真实写入上传尚未成功完成：
   - 日志里看不到 `upload` 类型记录，只有 `upload-simulate`，说明请求在进入或执行 `processUpload` 前就失败（怀疑为 Nginx/反向代理或其他中间层返回的 HTML 错误页）。
   - 前端已经使用 XHR + 手动 JSON 解析，会在日志区域打印：“服务器响应不是 JSON（状态 XXX）”以及 HTML 正文，便于分析。
2. 备份管理 UI 尚不完整：
   - 后端已有 `/api/data/backups`（列出近期上传前备份并清理过期），但前端还没有“备份列表 / 下载 / 删除”的界面。
3. 上传 UI 可以进一步提升：
   - 当前仅有文字形式的百分比进度与日志输出，没有图形进度条或更精细的步骤显示。
4. 文档同步不充分：
   - `data上传系统技术报告.md` 尚未合并 `STATUS.md` 中的实际实现说明与已知问题清单。

你的主要任务（按优先级）：

1. **查清真实写入上传失败的具体原因，并修复**  
   - 通过前端 XHR 日志获取失败时服务器返回的 HTML 错误页内容（状态码 + body），分析是 Nginx 的 `client_max_body_size`、超时、502/504 还是其他问题；  
   - 给出并实现对应的配置修改或应用层调整，使真实上传流程在生产环境下可以完整跑通（并出现 `type: 'upload'` 的日志记录）。
2. **为备份列表实现前端 UI 和必要的后端接口扩展**  
   - 基于 `/api/data/backups`，在前端增加“备份列表”展示，区分最近一次备份（回滚点）与更早的备份；  
   - 视需要增加下载/删除接口和按钮（注意只允许操作 TEMP_ROOT 下本用户 + handle 对应的自动备份）。
3. **进一步打磨上传 UI 与日志体验**  
   - 保留现有文本进度，增加简单进度条、禁用按钮逻辑、错误高亮等；  
   - 确保模拟与真实模式的行为和反馈对普通用户清晰易懂。
4. **更新文档**  
   - 将 `dmsystem/STATUS.md` 的关键信息合并到 `data上传系统技术报告.md` 开头的“实施状态说明”；  
   - 在 README/文档中补充 TEMP_ROOT 路径结构、日志格式，以及对生产环境注意事项（如 Nginx 配置）。

在改动代码时，请遵守：

- 只在 `dmsystem/` 目录中工作，不随意修改主项目 `src/`、`default/` 里的逻辑；
- 保持 ES modules、4 空格缩进、单引号语法风格（详见根目录 `AGENTS.md`）；
- 修改后优先自测上传/回滚/日志再交付。 

