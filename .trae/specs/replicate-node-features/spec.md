# 复刻 Node.js CLI 功能到桌面版 Spec

## Why
当前 C# WPF 桌面版功能严重缺失，上传/下载逻辑混乱，文件列表视图不完整，与 Node.js CLI 版本差距巨大。需要将 Node.js 版本的核心功能完整复刻到桌面版，使其成为真正可用的文件存储工具。

## What Changes
- **重写文件列表视图**：从 main.json 获取完整文件目录树，支持文件夹导航，显示文件版本数
- **重写上传功能**：复刻 Node.js 版的上传逻辑（分块→上传到数据项目→更新 main.json 索引→部署到主项目），支持上传文件和目录
- **新增下载功能**：复刻 Node.js 版的下载逻辑（从 main.json 获取分块 URL→并行下载分块→合并→本地保存），支持指定版本下载
- **新增删除功能**：从 main.json 中删除文件/文件夹，重新部署索引
- **新增新建文件夹**：在 main.json 中创建文件夹节点
- **新增移动/重命名**：在 main.json 中移动或重命名文件/文件夹
- **移除"打开项目主页"按钮**
- **修复项目 URL**：使用 Cloudflare API 返回的 subdomain 字段（含防重后缀）
- **修复上传逻辑**：当前 UploadViewModel 的 main.json 更新逻辑有 bug（size 字段为 0，路径解析不正确）

## Impact
- Affected code:
  - `Cloudfiles.App/ViewModels/FileListViewModel.cs` — 完全重写
  - `Cloudfiles.App/ViewModels/UploadViewModel.cs` — 完全重写
  - `Cloudfiles.App/Views/FileListView.xaml` — 重写
  - `Cloudfiles.App/Views/FileListView.xaml.cs` — 重写
  - `Cloudfiles.Core/Api/CloudflareApiClient.cs` — 补充下载相关方法
  - `Cloudfiles.Core/Services/UploadService.cs` — 重写对齐 Node.js 逻辑
  - `Cloudfiles.Core/Services/DownloadService.cs` — 重写对齐 Node.js 逻辑
  - `Cloudfiles.Core/Services/ConfigService.cs` — 确保 DataProjectName 配置正确

## ADDED Requirements

### Requirement: 文件列表浏览
系统 SHALL 从主项目的 `{projectUrl}/main.json` 下载并解析文件索引，显示当前目录下的文件和文件夹。

#### Scenario: 加载文件列表
- **WHEN** 用户进入文件列表页面
- **THEN** 系统下载 main.json，解析 `fs_root.children`，显示文件和文件夹列表
- **AND** 文件夹排在前面，文件排在后面，各自按名称排序
- **AND** 显示列：名称、大小、版本数、修改时间
- **AND** 文件夹显示"文件夹"类型，文件显示版本数量（如"3 个版本"）

#### Scenario: 进入子文件夹
- **WHEN** 用户双击一个文件夹
- **THEN** 系统导航进入该文件夹，显示其 children 内容
- **AND** 面包屑导航更新显示当前路径

#### Scenario: 返回上级目录
- **WHEN** 用户点击"上一级"按钮
- **THEN** 系统导航到父文件夹，刷新文件列表

#### Scenario: 刷新文件列表
- **WHEN** 用户点击"刷新"按钮
- **THEN** 系统重新下载 main.json 并刷新显示

### Requirement: 上传文件
系统 SHALL 支持上传文件和目录到远程路径，复刻 Node.js 版 `up` 命令的完整逻辑。

#### Scenario: 上传单个文件
- **WHEN** 用户选择文件并指定远程路径
- **THEN** 系统将文件分块（按配置的分块大小），上传到数据项目
- **AND** 下载当前 main.json，在对应路径添加文件版本节点
- **AND** 重新部署 main.json 到主项目
- **AND** 如果同名文件已存在，添加为新版本（追加到数组）
- **AND** 如果同名文件夹已存在，报错

#### Scenario: 上传目录
- **WHEN** 用户选择一个目录上传
- **THEN** 系统递归上传目录下所有文件，在 main.json 中创建对应的文件夹结构

#### Scenario: 上传进度
- **WHEN** 上传进行中
- **THEN** 显示进度条和当前状态（分块上传中/更新索引中/部署中）

### Requirement: 下载文件
系统 SHALL 支持从云端下载文件，复刻 Node.js 版 `dl` 命令的逻辑。

#### Scenario: 下载最新版本
- **WHEN** 用户选中一个文件并点击下载
- **THEN** 系统从 main.json 获取最新版本的分块 URL，并行下载所有分块
- **AND** 合并分块为完整文件，保存到用户选择的本地路径
- **AND** 显示下载进度

#### Scenario: 下载指定版本
- **WHEN** 用户选择文件的历史版本下载
- **THEN** 系统获取该版本的分块 URL 并下载合并

### Requirement: 删除文件/文件夹
系统 SHALL 支持删除远程文件或文件夹，复刻 Node.js 版 `rm` 命令的逻辑。

#### Scenario: 删除文件
- **WHEN** 用户选中一个文件并点击删除
- **THEN** 系统从 main.json 中移除该文件的所有版本
- **AND** 重新部署 main.json

#### Scenario: 删除文件夹
- **WHEN** 用户选中一个文件夹并点击删除
- **THEN** 系统从 main.json 中移除该文件夹及其所有子内容
- **AND** 重新部署 main.json

### Requirement: 新建文件夹
系统 SHALL 支持在远程目录中创建文件夹，复刻 Node.js 版 `mkdir` 命令的逻辑。

#### Scenario: 创建文件夹
- **WHEN** 用户点击"新建文件夹"并输入名称
- **THEN** 系统在 main.json 当前目录的 children 中添加文件夹节点
- **AND** 重新部署 main.json

### Requirement: 移动/重命名
系统 SHALL 支持移动或重命名文件/文件夹，复刻 Node.js 版 `mv` 命令的逻辑。

#### Scenario: 重命名
- **WHEN** 用户选中文件/文件夹并选择重命名
- **THEN** 系统在 main.json 中修改节点名称
- **AND** 重新部署 main.json

#### Scenario: 移动
- **WHEN** 用户选中文件/文件夹并选择移动到目标路径
- **THEN** 系统在 main.json 中将节点从源位置移到目标位置
- **AND** 重新部署 main.json

### Requirement: 版本管理
系统 SHALL 显示文件的版本历史，支持查看和下载历史版本。

#### Scenario: 查看版本历史
- **WHEN** 用户右键或双击一个文件
- **THEN** 系统显示该文件的所有版本列表（创建时间、大小、版本名称）

## MODIFIED Requirements

### Requirement: 设置页面
设置页面 SHALL 包含 API Token、账户 ID、主项目选择（ComboBox）、数据项目名称、分块大小配置。移除"打开项目主页"链接。

### Requirement: 项目 URL
系统 SHALL 使用 Cloudflare API 返回的 `subdomain` 字段构建项目 URL，需检查 subdomain 是否已包含 `.pages.dev` 后缀。

## REMOVED Requirements

### Requirement: 打开项目主页按钮
**Reason**: 用户不需要，项目主页对文件存储工具无意义
**Migration**: 从 FileListView 工具栏移除

### Requirement: 部署列表视图
**Reason**: 这是 Pages 管理工具的功能，不是文件存储工具的功能
**Migration**: 已在 v3.1.0 移除，替换为文件列表视图
