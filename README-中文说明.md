# EAG Listing Hub 使用与设定说明

把 WhatsApp 群组聊天变成可以搜索的房源资料库，并自动把房源和客户需求（WTB 求购 / WTR 求租）配对。

- **登录：** Supabase（用 Google 账号登录）。**数据库：** Supabase 的 Postgres。
- 经纪**搜索和配对**都在手机浏览器里直接计算，**不用 AI、零费用**。
- 只有你邀请的 Gmail 才能看到资料；搜索引擎不会收录（noindex）。
- 身份：**Admin 管理员**（只有你一个）/ **Editor 编辑**（可以导入）/ **Viewer 经纪**（只能搜索和配对）。
  权限由数据库本身（Row Level Security）把关，就算有人懂技术、在浏览器控制台乱改，也写不进去。

---

## 一、先在自己电脑试用（不需要任何账号）

1. 安装 Node.js（https://nodejs.org ，选 LTS 版本）。
2. 在这个文件夹打开终端，输入：
   ```
   npm install
   npm run serve
   ```
3. 打开 http://localhost:5173/listinghub/
4. 选择 **Admin 管理员** → **导入房源 Import** → 选择 `sample-data` 里的示范聊天文件。
5. 试试 Listing 搜索、智能配对 Match；也可以登出再用 **Viewer 经纪** 登录，看经纪看到的画面。

> 这是「本地测试模式」：资料只存在这台电脑的浏览器里，不会影响正式资料。

---

## 二、正式上线的设定（只需做一次）

### 1. 建立 Supabase 项目
1. 打开 https://supabase.com → 登录 → **New project**。
   - 名字：`eag-listing-hub`；地区（Region）选 **Southeast Asia (Singapore)**；设一个数据库密码并记下来。
2. 左边 **SQL Editor** → **New query** → 把本文件夹 `supabase/schema.sql` 的全部内容贴上 → **Run**。
   - 看到 “Success” 就完成了。这一步建立所有资料表和权限规则。
   - 管理员邮箱写在里面是 `constancechan.cc@gmail.com`。要换人的话，要同时改 `supabase/schema.sql` 和 `listinghub/js/supabase-config.js`。
3. 左边 **Project Settings → API**（或 **Data API**），记下三样东西：
   - **Project URL**（像 `https://abcd1234.supabase.co`）
   - **anon / publishable key**（公开的，可以放网页）
   - **service_role / secret key**（**秘密！只放 Vercel，不要放网页、不要发给别人**）
4. 打开 `listinghub/js/supabase-config.js`，填上 **Project URL** 和 **anon key**，保存。

### 2. 开启 Google 登录
1. 打开 https://console.cloud.google.com → 建立一个项目（例如 `EAG Listing Hub`）。
2. **APIs & Services → OAuth consent screen**：类型选 External，填应用名称和你的邮箱，保存。
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**：
   - 类型：**Web application**
   - **Authorized redirect URIs** 加入：`https://你的项目.supabase.co/auth/v1/callback`
   - 建好后复制 **Client ID** 和 **Client secret**。
4. 回到 Supabase → **Authentication → Sign In / Providers**：
   - **Google** → 开启，贴上 Client ID 和 Client secret → Save。
   - **Email** → **关闭**（本系统只用 Google 登录）。
5. Supabase → **Authentication → URL Configuration**：
   - **Site URL**：`https://eag-listinghub.vercel.app/listinghub/`
   - **Redirect URLs** 加入：`https://eag-listinghub.vercel.app/listinghub/`、`https://*-constancechancc-9708s-projects.vercel.app/listinghub/`（测试网址）、`http://localhost:5173/listinghub/`

### 3. 定时导入用的 Google Drive（可以稍后再做）
1. 在同一个 Google Cloud 项目：**APIs & Services → Library** → 搜 **Google Drive API** → Enable。
2. **IAM & Admin → Service Accounts → Create service account** → 建好后进入 → **Keys → Add key → JSON**，会下载一个 JSON 文件。
   **千万不要**把这个文件放进项目文件夹或 GitHub。
3. 打开 JSON 文件，找到 `client_email`（像 `xxx@xxx.iam.gserviceaccount.com`）。
4. 在 Google Drive 建一个文件夹（例如「WhatsApp 导出」）→ **分享**给这个 `client_email`（查看者即可）。
5. 打开该文件夹，网址最后那一串就是**文件夹 ID**：`https://drive.google.com/drive/folders/这一串`。

### 4. Vercel（网站）
GitHub 仓库：https://github.com/constancechancc-web/EAG-ListingHub

1. 打开 https://vercel.com → 用账号 **constancechancc-9708** 登录。
2. **Add New… → Project** → 选 GitHub 的 **EAG-ListingHub** → **Import**。
   - Framework Preset 选 **Other**；其他设定保持默认（`vercel.json` 已经设定好）。
3. **Settings → Environment Variables** 加入：

| 名称 | 填什么 |
|---|---|
| `SUPABASE_URL` | Supabase 的 Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 的 service_role / secret key（秘密） |
| `CRON_SECRET` | 自己想一串长的随机文字 |
| `GOOGLE_SERVICE_ACCOUNT` | （定时导入）整个服务账号 JSON 文件的内容 |
| `GOOGLE_DRIVE_FOLDER_ID` | （定时导入）上面的文件夹 ID |
| `ANTHROPIC_API_KEY` | （可选）想用 AI 帮忙判断看不懂的讯息才需要 |
| `AI_IN_CRON` | （可选）填 `1` = 定时导入时也用 AI |

4. 加完之后 **Deployments → 最新一个 → Redeploy**。网址是 `https://eag-listinghub.vercel.app/listinghub/`。

> **定时导入 12:00 和 21:00**：Vercel 免费版（Hobby）每天只能跑一次定时任务；一天两次需要 Pro 版。
> 免费替代：用 cron-job.org 在 12:00 / 21:00（Asia/Kuala_Lumpur）呼叫 `https://eag-listinghub.vercel.app/api/listinghub/cron-import`，Header 加上 `Authorization: Bearer 你的CRON_SECRET`。

> ⚠️ **测试规则：** 你测试满意之前，**不要**邀请其他经纪。之后改代码时，先推到另一个分支（例如 `test`），Vercel 会给一个 Preview 测试网址，确认没问题才合并到 `main`。

---

## 三、上线步骤（按顺序）

1. 打开网址 → 用你的 Gmail 登录（= Admin）。
2. **后台 Backend** → 先按 **Download backup 下载备份**（以后每次删除前都要先备份）。
3. **导入房源 Import** → 上传一两个群组的聊天导出，检查房源和需求对不对。
4. **后台 Backend → Users 用户权限** → 先只加 **一位 Viewer** 经纪，请他用手机试用。
5. 没问题之后，才加入其他经纪（Viewer）和帮你导入的同事（Editor）。

---

## 四、日常使用

**导出 WhatsApp 聊天：** 群组 → 群名 → 更多 → **导出聊天 → 不含媒体（Without Media）**。
- 你：存到共享的 Google Drive 文件夹 → 每天 12:00、21:00 自动导入。
- Editor（iPhone/iCloud）：在 **导入房源 Import** 页直接上传 .zip 或 .txt。

**规则：**
- 群名有「EAG 卓越」→ 来源 EAG Listing；其他群 → TRR Group。
- 同一个聊天导入两次、或两个人导入同一个群，**不会重复**。
- 只保留 **90 天**内的讯息；更旧的自动隐藏，Admin 备份后才可删除。
- WhatsApp 名字「宝贝老公 hubby M」会显示为 **Roy Goh**。

**配对规则（严格）：** 同买/同租、类型完全一样、需求要有明确地区、价钱在预算范围内（租 ±RM2,000；买 ±RM50,000）、房间/厕所/银行估价达到要求。分数 50 以上才显示。

**封面和标志：** 封面图在 `listinghub/assets/CoverPhoto.png`，标志在 `listinghub/assets/EAG LOGO.jpg`。网站用的是缩小后的版本（`hero-bg.jpg`、`eag-logo.png`、`icon-*.png`）。Admin 也可以在 **后台 Backend → App logo** 直接换标志。

---

## 五、给技术人员

- `npm test`：解析、搜索、配对、去重、性能（5,000 房源 × 1,000 需求），以及在真实 Postgres（PGlite）里跑 `supabase/schema.sql` 的权限测试。部署前必须全部通过。
- 共用逻辑在 `listinghub/js/core/`（浏览器与服务器共用同一份代码）。
- 资料表：`listings`、`requests`（每条讯息一行，`id` = 讯息 hash）、`seen`（去重）、`app_users`（白名单）、`meta`（导入记录、标志）。
- 去重 hash = 时间（到分钟）+ 讯息内容。**刻意不包含发送者名字**：不同人手机里存的联系人名字不同，包含名字会造成重复。
- 网页只用 anon key；service_role key 只在 Vercel 服务器（`api/listinghub/`）。
- Vercel 只发布 `listinghub/`（`scripts/build.js` → `public/`），测试、说明文件和示范聊天不会公开。
- AI 只在导入时用于规则判断不了的讯息，只发送讯息文字（电话号码已遮盖），模型 `claude-opus-5-5`；搜索和配对永远不用 AI。
