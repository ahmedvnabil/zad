<div align="center">

# زاد · Zad

**موجّه واحد متوافق مع OpenAI يجمع نماذج الذكاء الاصطناعي المجانية من 17+ مزوّداً.**

_One OpenAI-compatible endpoint that unifies free LLM tiers from 17+ providers — self-hosted, Arabic-first._

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-المساهمة)
![Self-hosted](https://img.shields.io/badge/self--hosted-%240%2Fmo-06b6d4)

![لوحة زاد](docs/screenshots/overview.png)

</div>

---

## ما هو زاد؟

عشرات النماذج المجانية الممتازة موجودة فعلاً — بس مبعثرة عبر 17+ مزوّداً، كل واحد بحدوده وصيغته ومفتاحه. **زاد** بيجمعهم كلهم خلف نقطة واحدة متوافقة مع OpenAI (`/v1/chat/completions`)، بيختار النموذج المناسب لكل طلب، ويحوّل احتياطياً للي بعده لو مزوّد وقع أو تجاوز حدّه — وأنت بتستخدم مفتاحاً واحداً.

مستضاف ذاتياً بالكامل: **مفاتيحك مشفّرة على سيرفرك، بياناتك ما بتطلعش برّه، وبدون أي فاتورة شهرية.**

<div align="center">

![عرض زاد](docs/demo.gif)

🎬 **[شاهد العرض الكامل (MP4)](docs/demo.mp4)**

</div>

## ✨ المميزات

- 🔌 **متوافق مع OpenAI** — بدّل `base_url` بس، أي SDK أو أداة بتشتغل على طول.
- 🌊 **17+ مزوّد · 100+ نموذج مجاني** بمفتاح واحد (Groq · Cerebras · SambaNova · NVIDIA · Mistral · OpenRouter · GitHub Models · Cohere · Cloudflare · Google · Zhipu · Ollama Cloud وغيرهم).
- 🔁 **تحويل احتياطي تلقائي** — يرتّب النماذج بالذكاء/السرعة/الميزانية ويقفز للي بعده عند الفشل أو تجاوز الحد.
- 💸 **تسعير حقيقي + حساب التوفير** — من جدول [LiteLLM](https://github.com/BerriAI/litellm)، يوريك كام كنت هتدفع لو مدفوع.
- 📊 **تحليلات حيّة (SSE)** — الطلبات، زمن الاستجابة، التوكنز، الأخطاء — تتحدّث لحظياً.
- 🔔 **إشعارات تليجرام** — مفتاح جديد/غير صالح · مزوّد وقع/رجع · ملخص يومي · طفرة أخطاء (تُضبط من الواجهة).
- ➕ **مزوّدون مخصّصون من الواجهة** — أضف أي خدمة متوافقة مع OpenAI وعدّل رابطها live (Ollama محلي · vLLM · LM Studio…).
- 🔐 **مفاتيح مشفّرة at-rest** + فحص صحة دوري + تعطيل تلقائي للمفاتيح الفاشلة.
- 🟢 **واجهة عربية كاملة RTL** بهوية حديثة، فاتح/داكن، بدون build step معقّد.

## 🚀 التشغيل السريع (Self-host)

> المتطلبات: **Node.js ≥ 20** + git. الخطوة الوحيدة المختلفة بين الأنظمة هي تثبيتهما:

| النظام | تثبيت المتطلبات |
|---|---|
| 🍎 **macOS** | `brew install node git` |
| 🐧 **Linux** (Debian/Ubuntu) | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash -` ثم `sudo apt install -y nodejs git` |
| 🪟 **Windows** (PowerShell) | `winget install OpenJS.NodeJS.LTS Git.Git` |

بعدها الأوامر واحدة على كل الأنظمة (Terminal أو PowerShell):

```bash
git clone <your-repo-url> zad && cd zad
npm install

# جهّز الإعدادات
cp .env.example .env
# ولّد مفتاح التشفير وحطّه في .env تحت ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ابنِ وشغّل
npm run build
node server/dist/index.js
```

افتح `http://localhost:3001`، روح صفحة **المفاتيح**، الصق مفتاح أي مزوّد مجاني (تسجيل مجاني بدون بطاقة) — وابدأ.

للتطوير: `npm run dev` (يشغّل الخادم + Vite معاً).

## 🔧 الإعدادات (env)

| المتغيّر | الغرض |
|---|---|
| `ENCRYPTION_KEY` | **مطلوب** — مفتاح 64-hex لتشفير المفاتيح المخزّنة. |
| `PORT` | منفذ الخادم (افتراضي 3001). |
| `INGEST_TOKEN` | يحمي endpoints الإضافة السريعة وإدارة المزوّدين (اختياري على شبكة موثوقة). |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | إشعارات تليجرام (أو اضبطها من صفحة التنبيهات). |
| `MERIDIAN_BASE_URL` / `CLIPROXY_BASE_URL` | تفعيل مزوّدات محلية اختيارية متوافقة مع OpenAI. |

كل التفاصيل في [`.env.example`](./.env.example).

## 🧪 الاستخدام (OpenAI-compatible)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3001/v1",
    api_key="<مفتاح-زاد-الموحّد>",   # من صفحة المفاتيح
)

resp = client.chat.completions.create(
    model="auto",                      # خلّي زاد يختار + يحوّل احتياطياً
    messages=[{"role": "user", "content": "أهلاً!"}],
)
print(resp.choices[0].message.content)
```

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer <مفتاح-زاد-الموحّد>" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"أهلاً!"}]}'
```

`model: "auto"` = زاد يقرّر (مع التحويل الاحتياطي)، أو حدّد معرّف نموذج بعينه. الاستجابة بترجع هيدر `X-Routed-Via` يوضّح أي مزوّد/نموذج خدم الطلب.

## 🏗️ المعمارية

- **الخادم:** Express + better-sqlite3 (المفاتيح مشفّرة، فحص صحة، توجيه + تحويل احتياطي، بروكسي متوافق مع OpenAI).
- **الواجهة:** React + Vite + Tailwind (RTL)، بدون اعتماد على build معقّد.
- **التخزين:** SQLite محلي — مفيش خدمة خارجية، مفيش تتبّع، بياناتك عندك.

## 📸 لقطات

| ساحة التجربة | التحويل الاحتياطي |
|:---:|:---:|
| ![ساحة التجربة](docs/screenshots/playground.png) | ![التحويل الاحتياطي](docs/screenshots/fallback.png) |
| **التحليلات** | **التنبيهات (تليجرام)** |
| ![التحليلات](docs/screenshots/analytics.png) | ![التنبيهات](docs/screenshots/notifications.png) |
| **المفاتيح والمزوّدون** | **سجلّ الطلبات** |
| ![المفاتيح](docs/screenshots/keys.png) | ![الطلبات](docs/screenshots/requests.png) |

## 🙏 البناء على (Attribution)

زاد **مبني على ومشتقّ من** مشروع [`freellmapi`](https://github.com/tashfeenahmed/freellmapi) (رخصة MIT) لـ **Tashfeen Ahmed** — شكراً للعمل الأصلي الممتاز.

أضافت نسخة زاد فوقه: تعريب كامل RTL + هوية بصرية جديدة، تسعير LiteLLM حقيقي وحساب التوفير، تحديثات حيّة عبر SSE، إشعارات تليجرام بصفحة إعدادات، إضافة/تعديل مزوّدين ديناميكياً من الواجهة، تجربة فورية من لوحة المعلومات، ومزوّدين إضافيين.

## 🤝 المساهمة

المساهمات مرحَّب بها — افتح issue أو PR. شغّل الاختبارات بـ `npm test -w server`.

## 📄 الترخيص

MIT — انظر [`LICENSE`](./LICENSE). يحتفظ بحقوق المؤلف الأصلي ويضيف تعديلات زاد.
