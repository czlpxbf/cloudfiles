# Cloudfiles v1.0.0

<div align="center">

**无限云存储解决方案**

*基于 Cloudflare Pages 构建 • 完全免费 • 无限空间*

</div>

---

## ⚠️ 使用前必读

```
┌──────────────────────────────────────────────────────────────┐
│  1. 本项目利用 Cloudflare Pages 的免费存储功能                │
│  2. 建议使用小号，不要使用主账号                              │
│  3. 重要文件请及时备份                                        │
│  4. Cloudflare 可能随时更改政策                               │
│                                                              │
│  ✅ 支持多次登录：已存在的项目不会覆盖数据                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 📋 安装步骤

### 第零步：下载本项目源代码<>Code————Download ZIP

### 第一步：安装 Node.js

1. 访问 [nodejs.org](https://nodejs.org)
2. 下载 **LTS 版本**（推荐）
3. 安装时一路点击 **Next** 即可

验证安装：
```bash
node --version
# 应显示版本号，如 v20.x.x
```

### 第二步：安装 Wrangler

打开命令行（CMD 或 PowerShell），运行：

```bash
npm install -g wrangler
```

验证安装：
```bash
wrangler --version
# 应显示版本号
```

### 第三步：下载并解压项目

下载 `cloudfiles_v1.0.0.zip` 并解压到任意目录。

### 第四步：运行初始化

双击 `login.bat`

按提示操作：
1. 登录 Cloudflare（会打开浏览器）
2. 输入项目名称（如：my-cloudfiles）
3. 等待完成

### 第五步：启动服务器

双击 `start.bat`

### 第六步：访问界面

打开浏览器访问 `http://localhost:8000`

---

## 🔄 多次登录支持

| 场景 | 行为 |
|------|------|
| **新项目** | 创建项目 + 部署初始文件 |
| **已存在项目** | 只更新配置，不覆盖数据 |

你可以：
- 在不同电脑上登录同一项目
- 随时重新登录更新配置
- 已有文件不会被覆盖

---

## 📁 项目结构

```
cloudfiles/
├── login.bat          # 初始化脚本
├── logout.bat         # 退出登录
├── start.bat          # 启动服务器
├── setup.js           # 初始化逻辑
├── server.js          # HTTP 服务器
├── main.js            # CLI 命令行工具
├── package.json       # 项目配置
├── README.md          # 说明文档
├── index/
│   ├── index.html     # Web 界面
│   └── index.css      # 样式文件
└── lib/
    ├── config.js      # 全局配置
    └── ...            # 其他模块
```

---

## ⚙️ 自定义品牌

编辑 `index/index.html`：

```html
<!-- 第21行: 浏览器标签标题 -->
<title>Cloudfiles</title>

<!-- 第31行: 左上角图标 -->
<img id="logoImg" src="你的图标URL" />

<!-- 第33行: 项目名称 -->
<h1 id="siteName">CLOUDFILES</h1>

<!-- 第34行: 项目标语 -->
<div class="subtitle" id="siteSubtitle">Unlimited Cloud Storage</div>
```

---

## 💻 CLI 命令

### 文件操作

```bash
# 上传文件
node main.js up ./本地文件.pdf /远程路径/

# 下载文件
node main.js dl /远程文件.pdf

# 删除文件或文件夹
node main.js rm /远程路径

# 创建文件夹
node main.js mkdir /新文件夹

# 移动/重命名
node main.js mv /旧路径 /新路径
```

### 版本管理

```bash
# 清理旧版本
node main.js cv --path /文件.pdf

# 给版本命名
node main.js rv /文件.pdf "时间戳" "版本名"
```

---

## 🖼️ 支持的文件类型

### 图片
JPEG, PNG, GIF, WebP, BMP, SVG, HEIC, HEIF

### 视频
MP4, WebM, OGG, MOV, AVI, MKV

### 文本（50+ 格式）
.js, .ts, .py, .java, .go, .html, .css, .json, .yaml, .md, .txt, .xml, .csv 等

---

## 🔧 常见问题

### Q: login.bat 闪退？

请确保已安装：
1. **Node.js** - 运行 `node --version` 检查
2. **Wrangler** - 运行 `wrangler --version` 检查

如果未安装，请按上面的步骤安装。

### Q: Connection Failed: API Error？

确保：
1. 已运行 `login.bat` 完成初始化
2. `lib/config.js` 中的配置正确

### Q: 端口被占用？

修改 `server.js` 第一行的端口号。

---

## 📄 开源协议

MIT License

---

<div align="center">

**Cloudfiles v1.0.0**

</div>
