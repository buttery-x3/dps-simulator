import {createCanvas} from '@napi-rs/canvas';
import {vi} from 'vitest';

const surfaces = new WeakMap();
HTMLCanvasElement.prototype.getContext = function () {
  let surface = surfaces.get(this);
  if (!surface) { surface = createCanvas(this.width || 160, this.height || 160); surfaces.set(this, surface); }
  if (surface.width !== this.width) surface.width = this.width;
  if (surface.height !== this.height) surface.height = this.height;
  return surface.getContext('2d');
};
HTMLCanvasElement.prototype.getBoundingClientRect = () => ({left: 0, top: 0, width: 1000, height: 560, right: 1000, bottom: 560});
HTMLElement.prototype.setPointerCapture = () => {};
HTMLElement.prototype.scrollIntoView = () => {};
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
Object.defineProperty(document, 'hidden', {value: false, writable: true, configurable: true});
document.hasFocus = () => true;
globalThis.matchMedia = () => ({matches: false});
vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
vi.stubGlobal('cancelAnimationFrame', vi.fn());
