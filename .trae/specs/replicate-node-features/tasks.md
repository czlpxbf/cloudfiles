# Tasks

- [ ] Task 1: 重写 Core 层 API 和服务
  - [ ] 1.1: 重写 `CloudflareApiClient.cs` — 补充 `DownloadChunksAsync`（并行下载分块）、确保 `GetFileIndexAsync`、`DeployMainJsonAsync`、`GetProjectAsync`、`DeployFilesAsync` 正确
  - [ ] 1.2: 重写 `UploadService.cs` — 对齐 Node.js `upload.js` 逻辑：分块→批量上传到数据项目→返回分块 URL 列表
  - [ ] 1.3: 重写 `DownloadService.cs` — 对齐 Node.js `operations.js` 下载逻辑：获取分块 URL→并行下载→合并保存
  - [ ] 1.4: 修复 `ConfigService.cs` — 确保 `GetProjectUrl` 使用 subdomain 字段并检查 `.pages.dev` 后缀，DataProjectName 配置正确

- [ ] Task 2: 重写 FileListViewModel 和 FileListView
  - [ ] 2.1: 重写 `FileListViewModel.cs` — 从 main.json 获取文件目录树，支持文件夹导航，显示名称/大小/版本数/修改时间，集成删除/新建文件夹/重命名/移动操作
  - [ ] 2.2: 重写 `FileListView.xaml` — 移除"打开项目主页"按钮，工具栏按钮绑定实际命令，双击文件夹导航，右键菜单（删除/重命名/下载），版本历史弹窗
  - [ ] 2.3: 更新 `FileListView.xaml.cs` — 事件处理

- [ ] Task 3: 重写 UploadViewModel 和 UploadView
  - [ ] 3.1: 重写 `UploadViewModel.cs` — 复刻 Node.js `handleUpload`：选择文件/目录→分块上传到数据项目→下载 main.json→添加文件版本节点→部署 main.json
  - [ ] 3.2: 更新 `UploadView.xaml` — 支持选择文件和目录，远程路径输入，上传进度显示

- [ ] Task 4: 编译验证和修复
  - [ ] 4.1: 本地 `dotnet build` 验证编译通过
  - [ ] 4.2: 修复所有编译错误

- [ ] Task 5: 构建发布
  - [ ] 5.1: 提交推送，打 v3.2.0 标签触发 GitHub Actions 构建

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 2, Task 3]
- [Task 5] depends on [Task 4]
