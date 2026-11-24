# チケット

工場に作ってほしいことを書く場所です。

## 流れ

1. `tickets/inbox/<ID>.md` に下書きを書く（`inbox/` は git で追跡しない）
2. `factory/bin/factory plan <ID>` で、planner が仕様の案を作る
3. 仕様を確認・編集してから、`factory/bin/factory approve <ID>` で承認する
4. ラインが、チケット・仕様・受け入れテスト・実装を PR にまとめる。チケットは `tickets/<ID>.md` としてコミットされる

## 書式

```markdown
---
id: T-001
title: タスクを追加する add コマンド
---

## 要望

やりたいことを、利用者の目線で書く。
```

- `id` は `T-` と3桁の数字
- 公開リポジトリに載るため、実在の組織名・個人名・メールアドレス・社内の事情を書かない
