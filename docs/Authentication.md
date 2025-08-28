# 小智AI管理后台认证功能说明

## 概述

小智AI的MCP服务管理界面现已支持管理员登录认证机制，确保只有授权用户才能访问后台管理页面。

## 功能特性

### 🔐 安全认证
- JWT (JSON Web Token) 认证机制
- 支持明文密码和bcrypt加密密码
- 自动token刷新机制
- 会话超时控制

### ⚙️ 配置驱动
- 管理员账号密码通过配置文件管理
- 可开启/关闭认证功能
- 支持自定义JWT密钥和会话超时

### 🎨 用户友好
- 现代化登录界面
- 响应式设计支持移动端
- 清晰的错误提示
- 用户状态显示和登出功能

## 配置说明

### 1. 认证配置结构

在`xiaozhi.config.json`配置文件中添加认证配置：

```json
{
  "webUI": {
    "port": 9999,
    "auth": {
      "enabled": true,
      "admin": {
        "username": "admin",
        "password": "admin123"
      },
      "jwtSecret": "your-super-secret-jwt-key-change-this-in-production",
      "sessionTimeout": 86400
    }
  }
}
```

### 2. 配置参数详解

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | false | 是否启用认证功能 |
| `admin.username` | string | "admin" | 管理员用户名 |
| `admin.password` | string | "admin123" | 管理员密码（支持明文和bcrypt加密） |
| `jwtSecret` | string | "default-secret-key" | JWT签名密钥，生产环境必须修改 |
| `sessionTimeout` | number | 86400 | 会话超时时间（秒），默认24小时 |

## 使用方法

### 1. 启用认证功能

编辑配置文件，将`auth.enabled`设置为`true`：

```json
{
  "webUI": {
    "auth": {
      "enabled": true
    }
  }
}
```

### 2. 修改管理员凭据

```json
{
  "webUI": {
    "auth": {
      "admin": {
        "username": "your_admin_username",
        "password": "your_secure_password"
      }
    }
  }
}
```

### 3. 使用bcrypt加密密码（推荐）

为了安全起见，建议使用bcrypt加密密码：

```bash
# 使用Node.js生成bcrypt密码
node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('your_password', 10));"
```

然后将生成的hash值填入配置文件：

```json
{
  "webUI": {
    "auth": {
      "admin": {
        "username": "admin",
        "password": "$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### 4. 生产环境安全配置

生产环境必须修改以下配置：

```json
{
  "webUI": {
    "auth": {
      "enabled": true,
      "admin": {
        "username": "your_secure_username",
        "password": "$2a$10$secure_bcrypt_hashed_password"
      },
      "jwtSecret": "your-super-secret-jwt-key-512-bits-long-minimum",
      "sessionTimeout": 28800
    }
  }
}
```

**安全建议：**
- 使用强密码（至少12位，包含大小写字母、数字、特殊字符）
- 使用bcrypt加密密码
- JWT密钥至少512位随机字符串
- 根据需要调整会话超时时间

## 界面操作

### 1. 登录界面

当启用认证功能时，访问管理界面会自动跳转到登录页面：

- 输入用户名和密码
- 点击"登录"按钮
- 登录成功后自动进入管理界面

### 2. 已登录状态

登录成功后，页面右上角会显示：

- 用户图标和用户名
- 点击可显示下拉菜单
- 包含"登出"选项

### 3. 自动登出

以下情况会自动登出：

- 会话超时
- Token失效
- 服务器返回认证错误

## API接口

系统提供以下认证相关的API接口：

### 1. 登录
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

### 2. 登出
```http
POST /api/auth/logout
Authorization: Bearer <token>
```

### 3. 验证Token
```http
GET /api/auth/verify
Authorization: Bearer <token>
```

### 4. 刷新Token
```http
POST /api/auth/refresh
Authorization: Bearer <token>
```

### 5. 获取认证状态
```http
GET /api/auth/status
```

## 故障排除

### 1. 无法登录

**问题：** 输入正确的用户名密码仍无法登录

**解决方案：**
- 检查配置文件中的认证配置是否正确
- 确认密码格式（明文或bcrypt）
- 查看服务器日志获取详细错误信息

### 2. 频繁登出

**问题：** 登录后很快就被自动登出

**解决方案：**
- 检查`sessionTimeout`配置
- 确认系统时间是否正确
- 检查JWT密钥是否稳定

### 3. 认证功能无效

**问题：** 设置`enabled: true`后仍可直接访问

**解决方案：**
- 重启Web服务器
- 检查配置文件语法
- 确认配置文件路径正确

### 4. 配置更新不生效

**问题：** 修改配置后认证状态未更新

**解决方案：**
- 重启小智客户端服务
- 清除浏览器缓存
- 检查配置文件保存是否成功

## 开发集成

### 前端集成

前端请求需要包含认证头：

```typescript
// 使用AuthService
import { AuthService } from './services/AuthService';

// 自动添加认证头的请求
const response = await AuthService.authenticatedFetch('/api/config');

// 手动添加认证头
const headers = AuthService.getAuthHeaders();
const response = await fetch('/api/status', { headers });
```

### 中间件保护

后端API路由使用认证中间件保护：

```typescript
// 需要认证的路由
app.get("/api/config", authMiddleware, handler);

// 可选认证的路由
app.get("/api/public", optionalAuthMiddleware, handler);

// 公开路由（无需认证）
app.get("/api/auth/status", handler);
```

## 更新日志

### v1.6.3
- ✅ 添加JWT认证机制
- ✅ 实现登录/登出功能
- ✅ 支持bcrypt密码加密
- ✅ 自动token刷新
- ✅ 现代化登录界面
- ✅ 配置驱动的认证控制

## 许可证

本功能遵循项目的开源许可证，详见 [LICENSE](../LICENSE) 文件。
