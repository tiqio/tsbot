---
name: git-workflow
description: 需要提交代码、查看变更历史或整理提交信息时使用。
---

# Git 工作流 SOP

1. 动手前先 `git status` 与 `git diff`，确认工作区里有什么。
2. 提交信息用中文，第一行写"做了什么"，空一行后写"为什么"。
3. 不要 `git add .` 之后不检查就提交，先看 `git diff --cached`。
4. 不要改写已经推送的历史。
