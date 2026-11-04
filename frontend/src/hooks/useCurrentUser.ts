import { useEffect, useState } from 'react';
import type { User } from '@/types';
import { authApi } from '@/services/api';
import { getToken } from '@/services/http';

/**
 * 当前登录用户（带缓存）
 *
 * 角色决定采购单的提交行为：
 *   - admin（管理者 GM）：提交即通过，免审批
 *   - buyer（采购员 SALES）：提交后进入「待审批」，需管理者审批
 *
 * 缓存按 token 失效，切换账号 / 退出登录后会重新拉取。
 */

let cache: { key: string; user: User | null } | null = null;
let pending: Promise<User | null> | null = null;

/** 退出登录 / 切换账号时调用，清掉缓存 */
export function resetCurrentUserCache() {
  cache = null;
  pending = null;
}

export function useCurrentUser(): User | null {
  const [user, setUser] = useState<User | null>(cache?.user ?? null);

  useEffect(() => {
    const key = getToken();
    if (cache && cache.key === key) {
      setUser(cache.user);
      return;
    }

    let alive = true;
    pending ??= authApi
      .me()
      .catch(() => null)
      .then((u) => {
        cache = { key, user: u };
        pending = null;
        return u;
      });

    void pending.then((u) => {
      if (alive) setUser(u);
    });

    return () => {
      alive = false;
    };
  }, []);

  return user;
}

/** 是否管理者（GM）：采购单免审批、可审批他人的单据 */
export function isAdminUser(user: User | null): boolean {
  return user?.role === 'admin';
}
