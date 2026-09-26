// 元素的实际尺寸（CSS 像素）。示意地图按真实大小排版，字号和线宽在手机和投影上都不会跟着缩放。

import { useCallback, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

export function useSize<T extends Element>(): [(node: T | null) => (() => void) | undefined, Size | undefined] {
  const [size, setSize] = useState<Size>();
  const ref = useCallback((node: T | null) => {
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
