# software-factory-trial

AI エージェント（Claude Code）を作業者として使う「ソフトウェアファクトリー」を、ゼロから作って試すためのリポジトリです。

工場は、題材のプロダクト（Markdown でタスクを管理する CLI「mdtask」）を作ります。人は仕様を承認し、プルリクエストをマージします。仕様の具体化、テストの作成、実装、レビューは、工程ごとに分けたエージェントが担当します。

## 状態

**Phase 1（ライン v1）**：手動で起動するラインが1本あります。

- planner → 人の承認 → test-writer → red の確認 → builder → ローカルの事前チェック → PR 作成 → reviewer → 人のマージ
- CI は、工場の PR が各工程で触ってよいファイルだけを変更しているかを検査します

各 Phase で何を作るかは、[設計書](docs/factory-design.md)を参照してください。

## 工場の使い方

```bash
factory/bin/factory plan T-001      # tickets/inbox/T-001.md から仕様の案を作る
factory/bin/factory approve T-001   # 仕様を承認し、PR 作成まで進める
factory/bin/factory status          # 利用量と、未マージの PR を表示する
factory/bin/factory cleanup T-001   # マージ後に作業ツリーを片付ける
```

チケットの書き方は [tickets/README.md](tickets/README.md) を参照してください。工場を動かすには、WSL などの Linux 環境と、ログイン済みの Claude Code と gh が必要です。

## 構成

| パス                 | 内容                                               |
| -------------------- | -------------------------------------------------- |
| `factory/`           | 工場本体（ライン制御、役割の定義、検証スクリプト） |
| `product/`           | 題材プロダクト「mdtask」                           |
| `docs/`              | 設計書と調査レポート                               |
| `.githooks/`         | コミット前・push 前の秘密情報スキャン              |
| `.github/workflows/` | CI（検証の最終的な判定。秘密情報は一切使わない）   |

## 必要なもの

- Node.js 24 以上
- git

## セットアップ

```bash
npm ci
npm run setup
```

`npm run setup` は、このリポジトリの git フックを有効にします。

## チェック

```bash
npm run check
```

型チェック、lint、テスト、秘密情報スキャンをまとめて実行します。

## 公開リポジトリとしての方針

- 認証情報、個人を特定できる情報、組織に固有の情報は載せません
- 秘密情報スキャンを、コミット前・push 前・CI の3か所で実行します
- 組織に固有の禁止語のリストは、リスト自体が機密になりうるため、リポジトリの外（`~/.config/software-factory/denylist.txt`）に置きます

詳しくは[設計書の「公開リポジトリの運用ルール」](docs/factory-design.md)を参照してください。

## ドキュメント

- [設計書](docs/factory-design.md)
- [ソフトウェアファクトリーの調査レポート](docs/software-factory-research.md)

## ライセンス

[MIT](LICENSE)
