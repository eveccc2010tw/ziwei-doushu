'use client';

/**
 * 全站繁體中文化（DOM 層）
 * - hydration 完成後才開始轉換，避免 hydration mismatch
 * - OpenCC cn→tw（含台灣用詞）；已是繁體的文字為冪等，不會二次變動
 * - MutationObserver 處理動態內容（AI 串流、命盤格子）
 * - 不動 input/textarea 的 value、script/style/code/pre
 */
import { useEffect } from 'react';

export default function Traditionalizer() {
  useEffect(() => {
    let conv: (s: string) => string = (s) => s;
    let convReady = false;
    const SKIP: Record<string, 1> = { INPUT: 1, TEXTAREA: 1, SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
    const ATTRS = ['placeholder', 'title', 'aria-label'];

    const obs = new MutationObserver((records) => {
      if (!convReady) return;
      for (const r of records) {
        if (r.type === 'characterData') {
          convertNode(r.target);
        } else if (r.type === 'attributes' && r.attributeName) {
          convertAttrs(r.target as Element);
        } else {
          r.addedNodes.forEach(convertNode);
        }
      }
    });

    function convertAttrs(el: Element) {
      if (SKIP[el.tagName]) return;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v) {
          const tv = conv(v);
          if (tv !== v) el.setAttribute(a, tv);
        }
      }
    }

    function convertNode(n: Node) {
      if (n.nodeType === Node.TEXT_NODE) {
        const p = n.parentElement;
        if (p && SKIP[p.tagName]) return;
        const s = n.nodeValue;
        if (!s || !s.trim()) return;
        const t = conv(s);
        if (t !== s) n.nodeValue = t;
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as Element;
      if (SKIP[el.tagName]) return;
      convertAttrs(el);
      el.childNodes.forEach(convertNode);
    }

    import('opencc-js')
      .then((m) => {
        conv = m.Converter({ from: 'cn', to: 'tw' });
        convReady = true;
        // hydration 後下一個 idle 再轉，避開 React hydration 比對
        (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback?.(() => {}) ?? null;
        setTimeout(() => {
          convertNode(document.body);
          const title = conv(document.title);
          if (title !== document.title) document.title = title;
          obs.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ATTRS,
          });
        }, 300);
      })
      .catch((e) => console.error('Traditionalizer init failed', e));

    return () => obs.disconnect();
  }, []);

  return null;
}
