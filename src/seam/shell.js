// src/seam/shell.js - Shell 能力 seam (吸收 dsh Service|Provider|Consumer 三层)
// Service Definition: 命令执行能力, 接口 = exec(cmd, opts) -> Promise<{stdout, stderr, code, ok}>
//   - Service: "shell" 这个能力 (key = "shell")
//   - Provider: LocalShellProvider (本地 execFile, 默认) | 未来 SandboxShellProvider (Docker/MicroVM)
//   - Consumer: run_command / code_act 工具, 通过 ctx.consume("shell") 获取实现, 换 provider 即换执行环境
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// 默认本地 shell provider: 在本机 shell 直接执行命令
// 约定: 永不 throw, 错误编码进返回值 (code != 0 或 ok=false), 与 LLM 重试内核的"失败编码进结果"一致
export class LocalShellProvider {
  async exec(cmd, { cwd, timeoutMs = 30000, maxBuffer = 1024 * 1024, env = null } = {}) {
    const isWin = process.platform === "win32";
    try {
      const { stdout, stderr } = await execFileP(isWin ? "cmd.exe" : "/bin/sh", [isWin ? "/c" : "-c", cmd], {
        cwd,
        timeout: timeoutMs,
        maxBuffer,
        env: env || undefined,
        windowsHide: true,
      });
      return { stdout: stdout || "", stderr: stderr || "", code: 0, ok: true };
    } catch (e) {
      return {
        stdout: "",
        stderr: String(e.message || e),
        code: typeof e.code === "number" ? e.code : 1,
        ok: false,
      };
    }
  }
}
