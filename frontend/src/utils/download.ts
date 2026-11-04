import { getToken } from '@/services/http';

/** 带登录态下载后端导出的文件（Excel / PDF） */
export async function downloadExport(
  path: string,
  filename: string,
  query?: Record<string, unknown>,
): Promise<void> {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    let message = `导出失败（HTTP ${res.status}）`;
    try {
      const data = await res.json();
      message = data?.message ?? message;
    } catch {
      /* 忽略 */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}
