import { cubicOut, cubicIn } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

// Shared navigation motion. Keep the brand and window chrome still.
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function pageEnter(_node: Element, { direction = 1 } = {}): TransitionConfig {
  if (reduceMotion()) return { duration: 0 };
  return {
    delay: 65,
    duration: 240,
    easing: cubicOut,
    css: (t, u) => `opacity: ${t}; transform: translate3d(${u * direction * 14}px, ${u * 4}px, 0);`,
  };
}

export function pageLeave(_node: Element): TransitionConfig {
  if (reduceMotion()) return { duration: 0 };
  return { duration: 110, easing: cubicIn, css: t => `opacity: ${t};` };
}

export function retirePage(event: Event) {
  const node = event.currentTarget as HTMLElement;
  // Outgoing content must not receive clicks, focus or screen-reader navigation.
  node.inert = true;
  node.setAttribute('aria-hidden', 'true');
  node.style.position = 'absolute';
  node.style.inset = '0 0 auto';
}

export function activatePage(event: Event) {
  const node = event.currentTarget as HTMLElement;
  // Svelte can reverse an outro when users navigate back before it completes.
  node.inert = false;
  node.removeAttribute('aria-hidden');
  node.style.removeProperty('position');
  node.style.removeProperty('inset');
}
