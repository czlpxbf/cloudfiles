# 修复 401 Unauthorized 错误

## 问题分析

用户报错：`验证失败:Response status code does not indicate success: 401 (Unauthorized)`

**根本原因**：每个 ViewModel（FileListViewModel、UploadViewModel、SettingsViewModel）各自创建独立的 `HttpClient` 和 `CloudflareApiClient` 实例。当用户在设置页面修改 API Token 后，只有 SettingsViewModel 的 `_apiClient` 更新了 token，其他 ViewModel 的 `_apiClient` 仍然使用旧 token 或空 token。

具体流程：
1. 用户打开设置页 → SettingsViewModel 创建新的 `_apiClient`，从配置加载 token
2. 用户修改 token → `PasswordChanged` 事件更新 `vm.ApiToken`，但只调了 `vm.ApiToken = ...`，**没有调用 `_apiClient.SetApiToken()`**
3. 用户点"验证 Token" → `VerifyToken()` 里才调 `_apiClient.SetApiToken(ApiToken)`，验证成功
4. 用户切到文件列表页 → MainViewModel 创建**全新的** `FileListViewModel`，新实例创建新的 `_apiClient`，从配置加载 token
5. **但如果用户还没点"保存设置"**，配置文件里还是旧 token → 401

更严重的问题：即使用户点了保存，切换页面时 MainViewModel 会 `new FileListViewModel()`，新实例从配置文件读取 token 并设置到自己的 `_apiClient`。这个流程本身是对的，但 `PasswordChanged` 事件只更新了 `vm.ApiToken` 属性，没有同步到 `_apiClient`。

## 修复方案

### 修改 1: SettingsViewModel — PasswordChanged 时同步更新 apiClient

文件：`desktop/src/Cloudfiles.App/ViewModels/SettingsViewModel.cs`

在 `ApiToken` 的 setter（由 CommunityToolkit 生成）被调用后，需要同步调用 `_apiClient.SetApiToken()`。

方法：重写 `OnApiTokenChanged` partial method：
```csharp
partial void OnApiTokenChanged(string value)
{
    _apiClient.SetApiToken(value);
}
```

### 修改 2: SettingsViewModel — Save 后通知其他页面刷新配置

当前架构下，每次切换页面都 new 一个新 ViewModel，新 ViewModel 会从配置文件加载 token。所以只要 Save 写入了配置文件，下次切页面时就能读到新 token。

但问题是：如果用户修改 token 后直接切页面（没点保存），新页面用的是旧配置。

**最小修复**：在 Save 方法里确保 token 已写入配置文件（当前已实现）。用户需要先保存再切页面，这是合理的。

### 修改 3: SettingsView.xaml.cs — PasswordChanged 同步 apiClient

当前 `ApiTokenBox_PasswordChanged` 只设置了 `vm.ApiToken`，需要额外调用 `SetApiToken`。但 `SetApiToken` 是内部方法，ViewModel 外部不可调用。

更好的方案：用 partial method `OnApiTokenChanged` 自动同步（修改 1 已覆盖）。

## 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `desktop/src/Cloudfiles.App/ViewModels/SettingsViewModel.cs` | 添加 `OnApiTokenChanged` partial method，自动同步 `_apiClient.SetApiToken` |

## 验证步骤

1. 打开应用 → 设置页
2. 输入 API Token（不点保存）
3. 点"验证 Token" → 应该成功（不再 401）
4. 切到文件列表页 → 如果已保存，应正常加载
