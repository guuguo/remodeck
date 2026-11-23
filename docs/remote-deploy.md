# 手机远程与固定链接全方案指南

RemoDeck（原 Agent Control）支持 **4 种远程访问方式**，默认推荐使用 **一键免费隧道（Cloudflare Quick Tunnel）**，零门槛 5 秒上手；如果你需要 **永久不变的固定 URL**（把网页添加到手机桌面、电脑重启后无需重新扫码），可以按需选择下面的 **Tailscale Funnel**、**Cloudflare Named Tunnel** 或 **Sealos / Docker 一键容器**。

---

## 一、4 种方案总览对比

| 方案 | 费用 | 是否固定域名 | 前置条件 | 适用场景 |
| :--- | :--- | :---: | :--- | :--- |
| **1. Cloudflare Quick Tunnel（默认）** | **0 元** | 临时随机 | 本机装 `cloudflared`（免账号） | 临时外出、偶尔手机看进度、零注册体验 |
| **2. Tailscale Funnel** | **0 元** | **永久固定**（`*.ts.net`） | 免费 Tailscale 账号 | 不买域名也不买服务器，想要手机免装 App 的永久固定链接 |
| **3. Cloudflare Named Tunnel** | **0 元隧道** | **永久固定**（自定义域名） | 1 个托管在 Cloudflare 的域名 | 已有个人域名，希望用自己域名 24 小时稳定常驻 |
| **4. 自托管中继（Sealos / Docker）** | **Sealos 约 ¥5～15/月** | **永久固定** | Sealos 账号或任意 Docker 主机 | 多设备稳定中继、断网/重启自动重连、不暴露本机直连隧道 |

> **安全说明**：以上前 3 种（直接把流量转发到本机 `127.0.0.1:43310`）都会自动触发 Agent Control 内置的 **本地隧道鉴权网关** —— 未经扫码配对的公网访问一律被拦截，只有通过 `/connect/<token>` 扫码写入 `HttpOnly` Cookie 的手机才能操作；第 4 种（Relay 中继）则通过主机出站 WebSocket 隧道 + 独立会话 Cookie 鉴权。

---

## 二、方案 2：Tailscale Funnel（0 元免域名 · 永久固定链接）

适合**不想买服务器也不想买域名**，但希望拥有永久固定链接的用户：

1. **安装并登录 Tailscale**：
   - macOS：`brew install --cask tailscale`（或从 [tailscale.com/download](https://tailscale.com/download) 下载客户端并登录）；
   - Windows：`winget install --id Tailscale.Tailscale`；
   - Linux：`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`。
2. **开启 MagicDNS、HTTPS 与 Funnel 权限**（仅首次需要）：
   - 登录 [Tailscale Admin Console → DNS](https://login.tailscale.com/admin/dns)，开启 **MagicDNS** 与 **HTTPS Certificates**；
   - 在控制台「手机远程 → 固定链接隧道 → Tailscale Funnel」点击 **「一键开启 Tailscale Funnel」**（或在终端执行 `tailscale funnel --bg 43310`）。如果 Tailnet 尚未开通 Funnel ACL，控制台会直接给出一条官方授权链接，点开确认一次后重试即可。
3. **扫码绑定**：
   - 开启后会自动生成带鉴权码的二维码（`https://你的设备名.tailxxxx.ts.net/connect/...`），手机相机扫一次即可；以后即使电脑重启，`tailscale funnel --bg` 也会由 Tailscale 后台继续托管同一固定域名。

---

## 三、方案 3：Cloudflare Named Tunnel（0 元固定隧道 · 需自备域名）

如果你名下已有任意一个托管在 Cloudflare DNS 的域名（例如 `yourdomain.com`），可以使用官方 **Named Tunnel**（完全免费且不限时）：

1. 登录 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks → Tunnels → Create a tunnel**（选择 **Cloudflared**）。
2. 复制页面给出的 `cloudflared service install <TOKEN>` 命令，在本机终端执行一次即可注册为系统常驻服务（若尚未安装 `cloudflared`，macOS 先 `brew install cloudflared`，Windows 先 `winget install --id Cloudflare.cloudflared`）。
3. 在同一个 Tunnel 的 **Public Hostname** 标签页添加一条路由：
   - **Subdomain / Domain**：例如 `agent.yourdomain.com`
   - **Service Type**：`HTTP`
   - **URL**：`127.0.0.1:43310`（不要填 `https`）
4. 打开 Agent Control 左上角 **「手机远程 → 固定链接隧道」**，在「固定公网地址」填入 `https://agent.yourdomain.com`，点击 **「生成固定链接配对二维码」** 即可扫码接入。
   - 若怀疑手机链接泄露，随时点击 **「重置二维码」**，已配对旧手机会立即失效。

---

## 四、方案 4：Sealos 成本说明与一键容器方案

### 1. Sealos 每月大概多少钱？

根据仓库 [deploy/sealos/relay.yaml](../deploy/sealos/relay.yaml#L112-L119) 与 [deploy/sealos/one-click.yaml](../deploy/sealos/one-click.yaml) 的实际资源配额：

- **CPU**：`requests 50m`（0.05 核）/ `limits 200m`（0.2 核）
- **内存**：`requests 64Mi` / `limits 192Mi`
- **存储卷**：`128Mi` PVC（保存配对关系与状态）

由于 `relay-server.mjs` 是一个极轻量的 Node.js `ws` 转发服务，平时没有人在手机上刷对话时 **CPU 几乎为 0**，主要占用仅 64Mi 左右内存与 128Mi 存储卷。按 Sealos 按量计费估算：

- **日常个人自用月成本通常约 ¥5 ～ ¥15 / 月（约 \$1～\$2/月）**；
- 成本受所在可用区单价与公网出站流量大小影响（如果经常在手机端预览高分辨率大图，流量费会略高一点；只看文字/代码流式输出几乎可忽略）；
- Sealos 新账号赠送的体验金通常足够稳定跑几个月测试。

---

### 2. Sealos 一键部署教程

#### 方式 A：Sealos App Launchpad 图形界面直接部署（最简单）

1. 在 Sealos 桌面打开 **「应用管理 (App Launchpad)」→「新建应用」**。
2. 填写基础信息：
   - **应用名称**：`agent-control-relay`
   - **镜像名**：`ghcr.io/guuguo/agent-control-relay:latest`
   - **CPU / 内存**：最低可选 `0.1 ~ 0.2 核` / `128Mi` 即可
   - **容器端口**：`8080`，开启 **「外网访问」**（记录生成的公网 HTTPS 地址，如 `https://xxxx.cloud.sealos.run`，也可绑定自己的自定义域名）
3. 添加环境变量：
   - `PORT` = `8080`
   - `RELAY_DATA_PATH` = `/data/state.json`
   - `RELAY_PUBLIC_URL` = `https://你的外网域名`（不带末尾 `/`）
   - `RELAY_KEY` = 本地执行 `openssl rand -hex 32` 生成的一串长随机密钥
4. 添加存储卷（可选，建议挂一块 **1GiB / 128Mi** 到 `/data`，重启 Pod 不丢失已配对设备凭证）。
5. 点击 **「部署应用」**，等待状态变为 `Running` 后，在本机执行下面命令生成一次性邀请码：

```bash
RELAY_PUBLIC_URL=https://你的外网域名 RELAY_KEY=你的密钥 npm run invite -- "我的 Mac"
```

把输出的邀请码填进 Agent Control 弹窗底部的 **「自托管固定中继」** 表单即可永久绑定。

#### 方式 B：Sealos 一行脚本部署（适合已导出 `KUBECONFIG` 或在 Sealos 终端操作）

仓库内提供了 [deploy/sealos/deploy.sh](../deploy/sealos/deploy.sh)（直接打包最新源码进 ConfigMap，不依赖外部镜像拉取）：

```bash
KUBECONFIG=~/.kube/sealos.yaml ./deploy/sealos/deploy.sh --host xxxx.cloud.sealos.run
```

或者使用标准单文件清单 [deploy/sealos/one-click.yaml](../deploy/sealos/one-click.yaml)（替换其中的 `__RELAY_HOST__` 和 `__RELAY_KEY__` 后 `kubectl apply -f`）。

---

### 3. 任意 Linux / 云服务器（Docker 一键容器方案）

如果你已经有一台装了 Docker 的 VPS 或家用 Linux，只需要一行命令即可拉起中继容器并自动生成随机密钥和首个邀请码：

```bash
git clone https://github.com/guuguo/remodeck.git
cd remodeck

# 模式 1：自带反代（Nginx/Caddy 指向本机 127.0.0.1:8080）
./deploy/one-click.sh --url https://relay.example.com

# 模式 2：免开服务器 80/443 端口（内置绑定 Cloudflare Named Tunnel）
./deploy/one-click.sh --url https://relay.example.com --cf-token <你的CloudflareTunnelToken>
```

如果不方便建 Nginx/Caddy，使用 **模式 2** 时服务器防火墙可以全关入站端口，只需把 Cloudflare Tunnel 指向 Docker 内部服务 `http://relay:8080` 即可。
