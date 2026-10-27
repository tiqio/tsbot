# 演示：线上 Nginx 为什么 502

本目录模拟一台小服务器：

- `nginx.conf` —— 反向代理配置
- `error.log` —— Nginx 错误日志（节选）
- `ports.md` —— 服务端口登记表
- `AGENTS.md` —— 运维基线守则
- `.claw/skills/ops_troubleshoot/SKILL.md` —— 排障 SOP

已知事实：后端服务在 `8082` 上监听，而 `nginx.conf` 里的 upstream 写成了 `8081`。
