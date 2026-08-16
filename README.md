# 360度評価システム バックエンドAPI

「360度評価システム データ定義書 v1.0」に基づく、Google Apps Script (GAS) Web アプリとして
実装したバックエンド API です。Google スプレッドシート上の4シート(社員マスタ／事業所マスタ／
評価期間マスタ／評価結果ログ)には、このWeb アプリ経由でのみ読み書きします。

デスクトップアプリ側は本 API の3エンドポイント(action)を呼び出すだけで、スプレッドシートに
直接アクセスすることはありません。

## 提供するAPI(action)

いずれも単一の Web アプリ URL(`.../exec`)に対して **POST + JSON ボディ** でリクエストします。
`action` フィールドで呼び出す処理を切り替えます。

| action | 説明 |
|---|---|
| `login` | 社員番号・パスワードでログイン認証し、トークンを発行する |
| `getMaster` | ログイン中の社員に紐づく事業所の評価項目・評価期間一覧・評価対象者一覧を取得する |
| `submitEvaluation` | 評価結果ログへ1件の評価を送信する |
| `ping` | 疎通確認(GETでも可) |

パスワードやトークンをURLに残さないため、`login` / `getMaster` / `submitEvaluation` は **GET非対応**
です(GETは`ping`のみ受け付けます)。

### 共通レスポンス形式

成功時:
```json
{ "success": true, ... }
```

失敗時:
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

### エラーコード一覧

| code | 意味 |
|---|---|
| `VALIDATION_ERROR` | 入力値不正・必須項目不足 |
| `INVALID_CREDENTIALS` | 社員番号またはパスワードが誤り、または退職者(有効フラグ=FALSE) |
| `AUTH_ERROR` | トークンが不正・期限切れ・対象社員が無効化された |
| `PERIOD_CLOSED` | 指定した評価期間が受付中でない |
| `DUPLICATE_SUBMISSION` | 同一(評価者, 被評価者, 期間)の評価が送信済み(要 overwrite 確認) |
| `DATA_ERROR` | マスタ間の参照整合性エラー(例: 事業所マスタに該当行がない) |
| `CONFIG_ERROR` | スクリプトプロパティ・シート未設定などサーバー設定不備 |
| `UNKNOWN_ACTION` | 不明な action |
| `METHOD_NOT_ALLOWED` | GETで認証系APIを呼んだ場合など |
| `INTERNAL_ERROR` | 想定外のサーバーエラー |

---

## 1. ログイン認証 `login`

**リクエスト**
```json
{ "action": "login", "employeeId": "100001", "password": "xxxxxxxx" }
```

**レスポンス**
```json
{
  "success": true,
  "token": "eyJzdWIiOiIxMDAwMDEi...ペイロード.署名",
  "expiresInMinutes": 480,
  "employee": {
    "employeeId": "100001",
    "name": "井出玲歌",
    "office": "Campo 台之郷",
    "isRepresentative": false
  }
}
```

- 社員マスタの社員番号・パスワードを完全一致で照合します。
- 有効フラグ=FALSE(退職者)は存在しない社員番号と同じエラーメッセージを返し、在籍有無を推測させません。
- `token` は社員番号+有効期限をスクリプトプロパティ`TOKEN_SECRET`でHMAC-SHA256署名したものです。
  以降の `getMaster` / `submitEvaluation` はこの `token` を必須パラメータとして渡します。

## 2. マスタ取得 `getMaster`

**リクエスト**
```json
{ "action": "getMaster", "token": "..." }
```

**レスポンス**
```json
{
  "success": true,
  "employee": { "employeeId": "100001", "name": "井出玲歌", "office": "Campo 台之郷", "isRepresentative": false },
  "evaluationItems": {
    "section1": { "title": "基本理念", "items": ["...", "...", "...", "...", "..."] },
    "section2": { "title": "チーム協働・褒め合う文化", "items": ["...", "...", "...", "...", "..."] },
    "freeText1Label": "基本理念について良かったこと",
    "freeText2Label": "チーム協働について良かったこと"
  },
  "periods": [
    {
      "periodId": "2026-summer",
      "periodName": "2026年夏季賞与向け評価",
      "startDate": "2026/05/01",
      "endDate": "2026/05/31",
      "status": "実施中",
      "isOpen": true
    }
  ],
  "targets": [
    { "employeeId": "100002", "name": "...", "office": "Campo 台之郷", "isRepresentative": false }
  ]
}
```

- `evaluationItems` はログイン社員の事業所に対応する事業所マスタの行から組み立てます。
- `periods` は評価期間マスタの全件。`isOpen` は「実施ステータス=実施中」かつ「本日が受付開始日〜受付終了日の範囲内」の両方を満たす場合に `true`。
- `targets`(評価対象者一覧, F-02)は「自分と同じ事業所の在籍社員」+「事業所を問わず代表フラグ=TRUEの在籍社員」で、自分自身は除外します。

## 3. 評価送信 `submitEvaluation`

**通常評価のリクエスト例**
```json
{
  "action": "submitEvaluation",
  "token": "...",
  "evaluateeId": "100002",
  "periodId": "2026-summer",
  "evaluationType": "通常",
  "scores1": [5, 4, 5, 3, 4],
  "scores2": [4, 4, 5, 5, 4],
  "freeText1": "基本理念についての自由記述",
  "freeText2": "チーム協働についての自由記述"
}
```

**代表向け簡易評価のリクエスト例(F-10)**
```json
{
  "action": "submitEvaluation",
  "token": "...",
  "evaluateeId": "999999",
  "periodId": "2026-summer",
  "evaluationType": "代表",
  "freeText1": "良いところ"
}
```

**レスポンス**
```json
{ "success": true, "logId": "xxxxxxxx-xxxx-...", "submittedAt": "2026-08-16T09:00:00.000Z", "overwritten": false }
```

### バリデーション・業務ルール

- `evaluationType` は `通常` / `代表` のいずれか。
- 自分自身を評価対象にはできません。
- 指定した `periodId` が存在し、かつ受付中(`isOpen`)である必要があります。そうでなければ `PERIOD_CLOSED`。
- 被評価者は在籍中(有効フラグ=TRUE)である必要があります。
  - `通常`評価: 評価者と同じ事業所の社員、または代表フラグ=TRUEの社員のみ指定可能(F-02の対象者一覧と整合)。
  - `代表`評価: 代表フラグ=TRUEの社員のみ指定可能。
- `通常`評価は `scores1` / `scores2` (各5要素・1〜5の整数)が必須。範囲外の値は `VALIDATION_ERROR` でエラーとします(7章の入力規則)。
- `代表`評価はスコア無し、自由記述2は使用しません(送信されても無視して空欄で記録)。
- **二重送信防止**: (評価者社員番号, 被評価者社員番号, 期間ID)が既に存在する場合、デフォルトでは `DUPLICATE_SUBMISSION` エラーを返します。ユーザーに上書き確認をとった上で `overwrite: true` を付けて再送信すると、既存行を新しい内容で上書きします(新規行の追加ではなく更新)。
- 判定〜書き込みは `LockService` でロックし、同時送信による二重登録を防ぎます。

---

## セットアップ手順

### 1. スプレッドシートの準備

データ定義書の通り、4シートを作成し、1行目に以下のヘッダーを入力してください(列の順序は問いません)。

**社員マスタ**
```
社員番号 | 氏名 | パスワード | メールアドレス | 事業所 | 代表フラグ | 有効フラグ
```

**事業所マスタ**
```
事業所名 | 部門 | 大項目1名 | 小項目1-1 | 小項目1-2 | 小項目1-3 | 小項目1-4 | 小項目1-5 |
大項目2名 | 小項目2-1 | 小項目2-2 | 小項目2-3 | 小項目2-4 | 小項目2-5 | 自由記述1ラベル | 自由記述2ラベル
```

**評価期間マスタ**
```
期間ID | 期間名 | 受付開始日 | 受付終了日 | 実施ステータス
```

**評価結果ログ**
```
ログID | 評価者社員番号 | 被評価者社員番号 | 期間ID | 評価種別 |
小項目1-1スコア | 小項目1-2スコア | 小項目1-3スコア | 小項目1-4スコア | 小項目1-5スコア |
小項目2-1スコア | 小項目2-2スコア | 小項目2-3スコア | 小項目2-4スコア | 小項目2-5スコア |
自由記述1 | 自由記述2 | 送信日時
```

- 社員番号列・期間ID列は「書式なしテキスト」に設定し、先頭0が消えないようにしてください。

### 2. GASプロジェクトの作成・デプロイ (clasp)

```bash
npm install
npx clasp login

# 既存のスタンドアロンGASプロジェクトを新規作成する場合
npx clasp create --type webapp --title "360度評価システム API" --rootDir src

# 生成された .clasp.json の scriptId を確認し、必要なら .clasp.json.example を参考に調整
npx clasp push
npx clasp deploy
```

デプロイ後、Web アプリのURL(`https://script.google.com/macros/s/xxxxx/exec`)を控えます。

### 3. スクリプトプロパティの設定

Apps Script エディタの「プロジェクトの設定」→「スクリプト プロパティ」で以下を設定します。

| キー | 値 | 必須 |
|---|---|---|
| `SPREADSHEET_ID` | 対象スプレッドシートのID(スタンドアロンスクリプトの場合) | コンテナバインド型スクリプトなら不要 |
| `TOKEN_SECRET` | ログイントークン署名用のランダムな秘密文字列(32文字以上推奨) | 必須 |

### 4. 動作確認

```bash
curl -s "https://script.google.com/macros/s/xxxxx/exec?action=ping"

curl -s -X POST "https://script.google.com/macros/s/xxxxx/exec" \
  -H "Content-Type: application/json" \
  -d '{"action":"login","employeeId":"100001","password":"xxxxxxxx"}'
```

---

## セキュリティ・実装上の注意

- パスワードはデータ定義書の仕様通り「本部発行の固定パスワード」を社員マスタに平文で保持する前提で実装しています。将来的にハッシュ化(例: `Utilities.computeDigest`によるSHA-256+ソルト)へ移行する場合は `AuthService.login` の比較ロジックのみ差し替えれば済む構成にしています。
- Web アプリは常にHTTPS経由でのみ提供されるため、通信経路上の盗聴リスクはGASの標準機能で担保されます。
- トークンは8時間で失効します(`Constants.js`の`TOKEN_TTL_MINUTES`で変更可能)。トークン検証時は毎回社員マスタを再照会し、ログイン後に有効フラグがFALSEへ変更された社員のアクセスも遮断します。
- ブラウザ(SPA等)から呼び出す場合、`Content-Type: application/json` はCORSプリフライトの対象になりGASでは正しく扱えないことがあります。デスクトップアプリ(Node/Electron等のサーバーサイドHTTPクライアント)からの利用を前提としています。
