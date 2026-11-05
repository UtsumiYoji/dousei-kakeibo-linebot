# dousei-kakeibo-linebot

LINEから `dousei-kakeibo` に支出を登録するためのWebhookサービスです。支出登録以外の清算計上、カテゴリ追加、メンバー追加などは扱いません。

## AI登録

`SAKURA_AI_TOKEN` を設定すると、さくらのAI Engineを使って画像とテキストから支出の下書きを作ります。下書きは承認されるまで登録しません。

- レシート画像を送ると、金額、カテゴリ、店名、日付を読み取ります。支払者は送信者です。
- `昨日スーパーで3200円` のように送ると、発言から下書きを作ります。
- `やっぱ3000円` のように送ると、直近の下書きを修正します。送信者本人の下書きを優先します。
- 確認カードの `登録` を押すか `登録` と送ると、`POST /api/expenses` を呼びます。許可されたチャットのメンバーなら誰でも承認できます。
- 支出と関係のない発言、レシート以外の画像には、グループでは反応しません。

読み取りには誤りが残るため、確認カードの金額は必ずレシートと見比べてください。下書きはメモリに保持するので、再起動すると消えます。

AIが使えないときは、次の `支出登録` で手入力できます。`サマリー` や `履歴` などのコマンドはLLMを使いません。

## Group chat

1. LINE Developersで `Allow bot to join group chats` を有効にし、Botをグループへ招待します。
2. グループで `グループID` と送り、返信された値を `LINE_ALLOWED_GROUP_IDS` に設定します。
3. 各メンバーがグループで `ユーザーID` と送り、`LINE_MEMBER_MAP` に対応を設定します。

許可したグループのメンバーは全員Botを使えます。`LINE_MEMBER_MAP` にない人が送った場合は、確認カードのボタンで支払者を選びます。

## Flow

LINEで `支出登録` と送ると、次の順に質問します。

1. 金額
2. カテゴリ
3. 支払者
4. 支出内容
5. 確認

登録時は `KAKEIBO_API_BASE_URL` の `POST /api/expenses` を呼びます。割り勘率は送らず、Webアプリ側のカテゴリ既定値を使います。

そのほか、LINEで次のメッセージを送ると現在の状況を確認できます。

- `サマリー`: 未清算支出の件数・合計と清算状況を返信します。
- `履歴`: 直近5件の支出登録内容を返信します。

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
LINE_ALLOWED_GROUP_IDS=Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LINE_MEMBER_MAP=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:太郎,Uyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy:花子
SESSION_TTL_MINUTES=15
DRAFT_TTL_MINUTES=1440
SAKURA_AI_TOKEN=your-sakura-ai-token
SAKURA_AI_MODEL=preview/Qwen3-VL-30B-A3B-Instruct
SUMMARY_SCHEDULE_CONFIG_PATH=
```

`LINE_ALLOWED_USER_IDS` と `LINE_ALLOWED_GROUP_IDS` はカンマ区切りで複数指定できます。

`LINE_MEMBER_MAP` は `userId:メンバー名` のカンマ区切りです。メンバー名の代わりにメンバーIDも使えます。

`SAKURA_AI_TOKEN` が空のときはAI登録が無効になり、`支出登録` の手入力だけが動きます。`SAKURA_AI_MODEL` は画像入力に対応したモデルを指定します。

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

userId確認のため、Botを友だち追加したあとLINEで `ユーザーID` と送ってください。Botが返信した値を `LINE_ALLOWED_USER_IDS` に設定します。このコマンドは初期設定用なので、allowlist登録前でも利用できます。運用時は許可されたuserIdだけが支出登録できます。

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
