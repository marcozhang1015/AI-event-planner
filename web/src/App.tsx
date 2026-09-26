// 网页入口：/sim 是网页模拟器，/demo 是不连后端的录屏页；其余路径是组织者看板（/o/:token）和个人行程页（/i/:token），只读（§5.6）。

import { lazy, Suspense } from "react";

// 模拟器和录屏页单独打包，看板和个人页不用加载它们的样式
const Simulator = lazy(() => import("./sim/Simulator").then((module) => ({ default: module.Simulator })));
const Demo = lazy(() => import("./demo/Demo").then((module) => ({ default: module.Demo })));
// 反过来也一样：看板和个人页的字体、样式只在这些页面加载
const Pages = lazy(() => import("./pages/Pages").then((module) => ({ default: module.Pages })));

export function App() {
  if (window.location.pathname === "/sim")
    return (
      <Suspense fallback={null}>
        <Simulator />
      </Suspense>
    );
  if (window.location.pathname === "/demo")
    return (
      <Suspense fallback={null}>
        <Demo />
      </Suspense>
    );
  return (
    <Suspense fallback={null}>
      <Pages path={window.location.pathname} />
    </Suspense>
  );
}
