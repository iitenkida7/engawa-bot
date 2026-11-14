# CLAUDE.md

このリポジトリで Claude が守るべきルールと、コードベースの全体像をまとめる。
**Claude の出力（会話・説明・質問）はすべて日本語。コミットメッセージ・コード中のコメントは英語。
PR のタイトル・本文は日本語で書く。**

## プロジェクト概要
engawa-bot は [engawa](https://github.com/iitenkida7/engawa)（ブラウザだけで使える仮想オフィス）に住む bot。
ノックされると会議に来て、録画・文字起こしをし、呼んだ人が抜けたら要約して Google ドライブ（またはローカル）に届ける。

**公開リポジトリ**。社名・社内ドメイン・社内 URL・鍵・メールアドレスなどの固有情報を**絶対にコミットしない**。
設定はすべて `.env` と `config/`（どちらも .gitignore 済み。例は `*.example*`）から受け取る。

## 方針（変えるときに外さない不変条件）
1. **engawa 本体に手を入れない** — bot は普通の参加者として engawa の Web クライアントを操作する。
   状況は engawa クライアント自身の WebSocket 通信（CDP の Network イベント）から読む。
2. **bot は自分の音声・映像を出さない** — Chrome にダミーデバイスを渡さず、マイク/カメラがオンなら毎回切る。
3. **届け先は社内ドメインのみ** — `ALLOWED_EMAIL_DOMAINS` 以外には共有しない。
4. **記録を失わない** — ドライブへの受け渡しに失敗したらローカルに残す。
5. **シンプルイズベスト** — 実行時の依存はゼロ（ブラウザ操作は Bun.WebView、Google/Groq は fetch で直接）。

## 技術スタック
- Bun + TypeScript（strict）/ Biome / `bun test`
- ブラウザ操作: Bun 組み込みの `Bun.WebView`（Chrome バックエンド。Docker では Debian の chromium）
- Docker / docker compose。N100 などの社内マシンで `make up` するだけで動く想定

## 構成（`src/`）
- `main.ts` — 起動。設定を読み、EngawaClient と Bot をつなぐ。
- `config.ts` — 環境変数の解釈（純粋関数）。
- `engawa/protocol.ts` — engawa の WS メッセージのうち使うものの型と解釈（純粋）。
- `engawa/world.ts` — 通信内容から組み立てる「いまの状況」（自分の位置・通話グループ・文字起こしなど。I/O なし）。
- `engawa/client.ts` — Bun.WebView で engawa を操作する層（入室・ノック応答・歩く・録画/文字起こしボタン・ダウンロード）。
- `engawa/map.ts` — `/api/map` から部屋名を引く。
- `bot/session.ts` — 会議の状態遷移（idle → heading → meeting）。副作用はアクションとして返す純粋関数。
- `bot/stroll.ts` — 散歩先の選び方（純粋）。
- `bot/bot.ts` — メインループ。イベントを状態遷移に流し、アクションを実行する。
- `meeting/record.ts` — 会議記録の整形（フォルダ名・文字起こし・要約ドキュメント・通知文。純粋）。
- `meeting/summarize.ts` — Groq の LLM で要約。
- `deliver/` — 受け取る人の解決（`recipients.ts`）、サービスアカウント認証（`google-auth.ts`）、
  Drive API（`drive.ts`）、届ける処理（`deliver.ts`）。

純粋ロジックはモジュールに切り出し、`src/__tests__/` でテストする（engawa と同じ方針）。

## コマンド（すべて Docker 経由）
| 目的 | コマンド |
|---|---|
| 起動 | `make up` |
| 停止 | `make down` |
| ログ | `make logs` |
| 依存インストール | `make install` |
| 型チェック | `make typecheck` |
| Lint | `make lint` |
| テスト | `make test` |

push 前に `make typecheck` / `make lint` / `make test` を通す。CI も同じ Makefile ターゲットを実行する。

## コーディング規約
- TypeScript strict / セミコロンあり / シングルクォート / インデント スペース 2 つ（Biome で整形）。
- import は `@/` エイリアス（`@/<folder>/<name>`）。

## 作業の進め方
- 仕様はユーザーと一緒に決める。不明点や判断に迷う点は実装前に確認する。
- 仕様が決まったらフィーチャーブランチで実装して PR を出す（PR が仕様と変更の記録を兼ねる）。
