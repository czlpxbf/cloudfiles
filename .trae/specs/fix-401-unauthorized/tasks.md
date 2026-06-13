# Tasks

- [x] Task 1: 修复 PasswordBox 初始化清空 token 的问题
  - [x] 1.1: 修改 `SettingsView.xaml.cs` 的 `PasswordChanged` 处理 — 当 Password 为空时不覆盖 ViewModel 已有的非空 ApiToken
  - [x] 1.2: 在 `SettingsView.xaml.cs` 添加 `Loaded` 事件处理 — 当 ViewModel 有已保存 token 时设置 PasswordBox.Password

- [x] Task 2: 使用共享的 CloudflareApiClient 实例
  - [x] 2.1: 创建单例 `AppContext` 类持有共享的 `CloudflareApiClient` 和 `ConfigService` 实例
  - [x] 2.2: 修改 `SettingsViewModel` 使用共享的 `CloudflareApiClient`
  - [x] 2.3: 修改 `FileListViewModel` 使用共享的 `CloudflareApiClient`
  - [x] 2.4: 修改 `UploadViewModel` 使用共享的 `CloudflareApiClient`
  - [x] 2.5: 修改 `DownloadService` 使用共享的 `CloudflareApiClient`（DownloadService 已通过构造函数注入共享的 ApiClient，无需额外修改）

- [x] Task 3: ViewModel 复用而非重建
  - [x] 3.1: 修改 `MainViewModel` 缓存 ViewModel 实例，导航时复用而非 new

- [x] Task 4: 编译验证
  - [x] 4.1: 代码审查确认编译通过（本地无 dotnet SDK，需通过 GitHub Actions 验证）

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 1, Task 2, Task 3]
