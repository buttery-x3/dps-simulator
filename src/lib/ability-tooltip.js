import {flushSync, mount, unmount} from 'svelte';
import AbilityDetails from '../components/AbilityDetails.svelte';

let nextId = 0;
let dismissCurrent = null;

/** Fixed viewport coordinates; deliberately independent of the combat clock. */
export function tooltipPosition(anchor, size, viewport, margin = 12, gap = 10) {
  const leftEdge = (viewport.left ?? 0) + margin;
  const topEdge = (viewport.top ?? 0) + margin;
  const rightEdge = (viewport.left ?? 0) + viewport.width - margin;
  const bottomEdge = (viewport.top ?? 0) + viewport.height - margin;
  const width = Math.min(size.width, Math.max(0, rightEdge - leftEdge));
  const height = Math.min(size.height, Math.max(0, bottomEdge - topEdge));
  const above = anchor.top - gap - height;
  const below = anchor.bottom + gap;
  const desiredTop = above >= topEdge ? above : below + height <= bottomEdge ? below : above;
  return {
    left: Math.max(leftEdge, Math.min(anchor.left + (anchor.width - width) / 2, rightEdge - width)),
    top: Math.max(topEdge, Math.min(desiredTop, bottomEdge - height)),
  };
}

/** One transient tooltip at a time. Never focuses a node or handles combat keys. */
export function abilityTooltip(node, initial) {
  let options = initial;
  let popup, component;
  let hovered = false;
  let focused = false;
  let overPopup = false;
  let leaveTimer;
  let touchFocus = false;
  let previousDescription = null;
  const id = `ability-tooltip-${++nextId}`;

  function hide() {
    clearTimeout(leaveTimer);
    overPopup = false;
    if (!popup) return;
    window.removeEventListener('keydown', escape, true);
    window.removeEventListener('blur', hide);
    window.removeEventListener('resize', hide);
    document.removeEventListener('scroll', scroll, true);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('visibilitychange', hide);
    window.visualViewport?.removeEventListener('resize', hide);
    window.visualViewport?.removeEventListener('scroll', hide);
    if (previousDescription === null) node.removeAttribute('aria-describedby');
    else node.setAttribute('aria-describedby', previousDescription);
    if (component) unmount(component);
    popup.remove(); popup = null; component = null;
    if (dismissCurrent === hide) dismissCurrent = null;
  }

  function escape(event) {
    if (event.key !== 'Escape' && event.code !== 'Escape') return;
    // In a dialog, the first Escape dismisses the hint; the next closes the
    // dialog normally. An arena Escape still pauses and releases arena focus.
    if (node.closest('dialog[open]')?.contains(event.target)) event.preventDefault();
    hide();
  }
  function outside(event) { if (!node.contains(event.target) && !popup?.contains(event.target)) hide(); }
  function scroll(event) { if (!popup?.contains(event.target)) hide(); }
  function deferLeave() {
    clearTimeout(leaveTimer);
    if (!focused) leaveTimer = setTimeout(() => { if (!hovered && !overPopup && !focused) hide(); }, 100);
  }

  function show() {
    if (popup || options?.disabled || !options?.detail || !node.isConnected || node.closest('details:not([open])')) return;
    const dialog = node.closest('dialog');
    if (dialog && !dialog.open) return;
    dismissCurrent?.();
    popup = document.createElement('div');
    popup.id = id;
    popup.className = 'ability-tooltip';
    popup.setAttribute('role', 'tooltip');
    popup.setAttribute('popover', 'manual');
    popup.addEventListener('pointerenter', () => { overPopup = true; clearTimeout(leaveTimer); });
    popup.addEventListener('pointerleave', () => { overPopup = false; deferLeave(); });
    // The native popover top layer clears both canvas stacking and modal
    // clipping. Older browsers fall back inside the active dialog itself.
    (dialog ?? document.body).append(popup);
    component = flushSync(() => mount(AbilityDetails, {target: popup, props: {detail: options.detail, compact: true, preview: options.preview ?? false}}));
    try {
      if (!popup.showPopover) throw new Error('Popover unsupported');
      popup.showPopover();
    } catch { popup.removeAttribute('popover'); }
    const visual = window.visualViewport;
    const viewport = {left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
      width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight};
    popup.style.maxWidth = `${Math.max(0, viewport.width - 24)}px`;
    popup.style.maxHeight = `${Math.max(0, viewport.height - 24)}px`;
    const position = tooltipPosition(node.getBoundingClientRect(), popup.getBoundingClientRect(), viewport);
    popup.style.left = `${position.left}px`; popup.style.top = `${position.top}px`;
    previousDescription = node.getAttribute('aria-describedby');
    node.setAttribute('aria-describedby', id);
    dismissCurrent = hide;
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('visibilitychange', hide);
    visual?.addEventListener('resize', hide);
    visual?.addEventListener('scroll', hide);
  }

  function enter(event) { if (event.pointerType === 'touch') return; hovered = true; clearTimeout(leaveTimer); show(); }
  function leave() { hovered = false; deferLeave(); }
  function focus() { focused = true; if (!touchFocus) show(); }
  function blur() { focused = false; touchFocus = false; if (!hovered && !overPopup) hide(); }
  function pointerDown(event) {
    touchFocus = event.pointerType === 'touch';
    // Tapping always performs the button's normal action. The persistent
    // loadout inspector provides touch details without blocking combat taps.
    if (touchFocus) { hovered = false; hide(); }
  }
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', leave);
  node.addEventListener('focus', focus);
  node.addEventListener('blur', blur);
  node.addEventListener('pointerdown', pointerDown);
  return {
    update(next) {
      if (next?.detail !== options?.detail || next?.preview !== options?.preview || next?.disabled || next?.revision !== options?.revision) hide();
      options = next;
    },
    destroy() {
      hide();
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('focus', focus);
      node.removeEventListener('blur', blur);
      node.removeEventListener('pointerdown', pointerDown);
    },
  };
}
