# dousei-kakeibo-linebot

LINEから `dousei-kakeibo` に支出を登録するためのWebhookサービスです。支出登録以外の清算計上、カテゴリ追加、メンバー追加などは扱いません。

## Flow

LINEで `支出登録` と送ると、次の順に質問します。

1. 金額
2. カテゴリ
3. 支払者
4. 支出内容
5. 確認

登録時は `KAKEIBO_API_BASE_URL` の `POST /api/expenses` を呼びます。割り勘率は送らず、Webアプリ側のカテゴリ既定値を使います。

## Environment

```bash
cp .env.example .env
```

```env
PORT=3001
KAKEIBO_API_BASE_URL=http://app:3000
LINE_CHANNEL_SECRET=your-line-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-line-channel-access-token
LINE_ALLOWED_USER_IDS=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SESSION_TTL_MINUTES=15
SUMMARY_SCHEDULE_CONFIG_PATH=
```

`LINE_ALLOWED_USER_IDS` はカンマ区切りで複数指定できます。

## Development

```bash
npm install
npm run dev
```

Checks:

```bash
npm run lint
npm run test
```

## Docker

```bash
docker build -t dousei-kakeibo-linebot .
docker run --env-file .env -p 127.0.0.1:3001:3001 dousei-kakeibo-linebot
```

Health check:

```bash
curl http://127.0.0.1:3001/health
```

## LINE setup

1. LINE DevelopersでMessaging API channelを作成します。
2. Channel secretを `LINE_CHANNEL_SECRET` に設定します。
3. Channel access tokenを発行し、`LINE_CHANNEL_ACCESS_TOKEN` に設定します。
4. Webhook URLに既存リバースプロキシの公開HTTPS URLを設定します。
   - 例: `https://example.com/line/webhook`
   - リバースプロキシはこのサービスの `http://127.0.0.1:3001/webhook/line` へ転送します。
5. 利用者のLINE userIdを取得し、`LINE_ALLOWED_USER_IDS` に設定します。

userId確認のため、初回だけ一時的にログ出力を追加するか、LINE DevelopersのWebhookイベント確認機能などで送信元を確認してください。運用時は許可されたuserIdだけが支出登録できます。

## Scheduled summary

`SUMMARY_SCHEDULE_CONFIG_PATH` にJSON設定ファイルのパスを指定すると、指定時刻にLINE push messageでサマリーを送信します。

サマリー内容:

- 未清算支出の件数と合計金額
- 清算状況のメンバー別 `+/-` 金額

設定例:

```json
{
  "enabled": true,
  "timezone": "Asia/Tokyo",
  "recipients": [],
  "schedules": [
    { "type": "daily", "time": "21:00" },
    { "type": "weekly", "dayOfWeek": "sun", "time": "21:00" },
    { "type": "monthly", "dayOfMonth": 1, "time": "09:00" }
  ]
}
```

`recipients` が空の場合、`LINE_ALLOWED_USER_IDS` の全員へ送ります。`dayOfWeek` は `0-6`、`sun` から `sat`、または `日` から `土` を使えます。
