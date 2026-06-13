# 修复 401 Unauthorized 错误 Spec

## Why
用户在设置页面验证 Token 时持续收到 401 Unauthorized 错误。根本原因是 PasswordBox 初始化时清空了已加载的 token，且各 ViewModel 之间 token 不同步。

## What Changes
- 修复 PasswordBox 初始化时清空 token 的问题
- 将 PasswordBox 与 ViewModel 的 ApiToken 同步（加载已保存的 token）
- 使用共享的 CloudflareApiClient 实例，确保 token 在所有 ViewModel 间同步
- 每次导航时复用 ViewModel 而非重新创建

## Impact
- Affected code: `SettingsView.xaml.cs`, `SettingsViewModel.cs`, `FileListViewModel.cs`, `UploadViewModel.cs`, `MainViewModel.cs`

## ADDED Requirements

### Requirement: Token 不被 PasswordBox 初始化清空
系统 SHALL 确保 PasswordBox 初始化时不会清空已从配置加载的 token。

#### Scenario: PasswordBox 初始化不清空 token
- **WHEN** SettingsView 被创建且 PasswordBox 触发 PasswordChanged 事件
- **THEN** 如果 Password 为空且 ViewModel 已有非空 ApiToken，不应覆盖 ViewModel 的 token

### Requirement: PasswordBox 显示已保存的 token
系统 SHALL 在 SettingsView 加载时将已保存的 token 填入 PasswordBox。

#### Scenario: 加载已保存的 token
- **WHEN** 用户导航到设置页面且配置中有已保存的 token
- **THEN** PasswordBox 应显示已保存的 token（用占位符表示）

### Requirement: 所有 ViewModel 共享 token 状态
系统 SHALL 确保当用户在设置页面更新 token 后，其他 ViewModel 的 API 客户端也能使用新 token。

#### Scenario: 设置中更新 token 后其他页面可用
- **WHEN** 用户在设置页面输入新 token 并保存
- **THEN** 文件列表和上传页面的 API 调用应使用新 token

### Requirement: ViewModel 复用而非重建
系统 SHALL 在导航时复用已创建的 ViewModel 实例，而非每次导航都创建新实例。

#### Scenario: 多次导航到同一页面
- **WHEN** 用户从文件列表导航到设置再返回文件列表
- **THEN** 应复用之前的 FileListViewModel 实例，保留其状态
