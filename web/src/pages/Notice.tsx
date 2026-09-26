// 只有一句话的页面：没有 token 的路径、加载中、链接不存在。

import type { ReactNode } from "react";

export function Notice({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <main className="juno notice" aria-busy={busy}>
      <h1 className="notice-mark">Juno</h1>
      <p className="notice-text">{children}</p>
    </main>
  );
}
