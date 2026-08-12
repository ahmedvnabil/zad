# المساهمة في زاد

شكراً لاهتمامك! زاد مشروع مفتوح المصدر (MIT) ومشتقّ من [`freellmapi`](https://github.com/tashfeenahmed/freellmapi) لـ Tashfeen Ahmed.

## البنية

monorepo بـ npm workspaces:

- **`shared/`** — أنواع TypeScript مشتركة (`@zad/shared`)
- **`server/`** — Express + better-sqlite3 (الموجّه + الـ API + `/v1`)
- **`client/`** — React + Vite + Tailwind + shadcn/ui (الواجهة العربية RTL)

## التشغيل محلياً

```bash
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ضعه في ENCRYPTION_KEY
npm run dev        # الخادم + Vite معاً
```

## الاختبارات

```bash
npm test -w server     # vitest · قاعدة بيانات :memory:
npm run check:auth     # كل /api محروس أو معلن عام صراحةً
```

أي تغيير على المنطق لازم تضيف/تحدّث اختبار. كل الاختبارات لازم تعدّي قبل الـ PR.

## أسلوب الكود

- TypeScript صارم — مفيش `any` بدون مبرّر.
- مفاتيح/أسرار: **مشفّرة at-rest، ولا تُرجَّع أبداً من الـ API**.
- مفيش IPs داخلية أو أسرار في الكود — استخدم متغيّرات البيئة.
- نصوص الواجهة بالعربية؛ معرّفات الكود وأسماء المزوّدين بالإنجليزية.

## الـ Pull Requests

1. افتح issue للنقاش قبل التغييرات الكبيرة.
2. فرع وصفي + رسائل commit واضحة.
3. تأكّد إن `npm run build` و`npm test -w server` بيعدّوا.

> `npm install` بيثبّت hook اسمه `pre-push` تلقائيًا (عبر `postinstall`)، بيشغّل
> `check:auth` والاختبارات قبل أي دفع. لو ضفت راوت `/api` جديد من غير `requireOwner`
> الهوك هيقفل الدفع ويقولك تعمل إيه. للتعطيل: `git config --unset core.hooksPath`.
4. صف التغيير و«ليه» في الـ PR.

## الأمان

لو لقيت ثغرة أمنية، **متفتحش issue عام** — راسل المشرفين مباشرةً أولاً.
