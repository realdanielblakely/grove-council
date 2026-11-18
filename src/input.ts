import { clamp } from './utils/math';

export type Action = 'jump' | 'sit' | 'view' | 'mannequins' | 'overview' | 'hints';

const ACTION_KEYS: Record<string, Action> = {
  Space: 'jump',
  KeyE: 'sit',
  KeyV: 'view',
  KeyM: 'mannequins',
  KeyO: 'overview',
  KeyH: 'hints',
};

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
]);

/**
 * Keyboard, mouse (pointer lock or drag-to-orbit) and touch (virtual stick on
 * the left, drag-to-look on the right). Look input accumulates in pixels and
 * is consumed once per frame.
 */
export class Input {
  readonly look = { x: 0, y: 0 };
  zoom = 0;
  enabled = false;
  /** Fires once per action press, after the key or button goes down. */
  onAction: (action: Action) => void = () => {};
  onPointerLockChange: (locked: boolean) => void = () => {};

  private readonly keys = new Set<string>();
  private readonly stick = { x: 0, y: 0 };
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private dragging = false;
  private dragLast = { x: 0, y: 0 };
  private pointerLocked = false;
  private moveSinceDown = 0;

  private readonly surface: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;

  constructor(surface: HTMLElement, stickBase: HTMLElement, stickKnob: HTMLElement) {
    this.surface = surface;
    this.stickBase = stickBase;
    this.stickKnob = stickKnob;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    surface.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    surface.addEventListener('touchstart', this.onTouchStart, { passive: false });
    surface.addEventListener('touchmove', this.onTouchMove, { passive: false });
    surface.addEventListener('touchend', this.onTouchEnd);
    surface.addEventListener('touchcancel', this.onTouchEnd);
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.surface;
      this.onPointerLockChange(this.pointerLocked);
    });
  }

  get locked(): boolean {
    return this.pointerLocked;
  }

  /** Movement intent: x strafes right, y moves forward. Length is at most 1. */
  moveAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    x += this.stick.x;
    y += this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  running(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.stick.x, this.stick.y) > 0.92;
  }

  requestPointerLock(): void {
    if (matchMedia('(pointer: coarse)').matches) return;
    try {
      const result: unknown = this.surface.requestPointerLock();
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Pointer lock is optional; drag-to-look still works without it.
    }
  }

  consumeLook(): { x: number; y: number; zoom: number } {
    const out = { x: this.look.x, y: this.look.y, zoom: this.zoom };
    this.look.x = 0;
    this.look.y = 0;
    this.zoom = 0;
    return out;
  }

  trigger(action: Action): void {
    if (this.enabled) this.onAction(action);
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const action = ACTION_KEYS[e.code];
    if (action || MOVE_KEYS.has(e.code)) {
      if (!this.enabled) return;
      e.preventDefault();
    }
    if (MOVE_KEYS.has(e.code)) this.keys.add(e.code);
    if (action && !e.repeat) this.onAction(action);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private readonly onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (!this.pointerLocked && e.button === 0) {
      this.dragging = true;
      this.moveSinceDown = 0;
      this.dragLast = { x: e.clientX, y: e.clientY };
    }
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (this.pointerLocked) {
      this.look.x += e.movementX;
      this.look.y += e.movementY;
    } else if (this.dragging) {
      const dx = e.clientX - this.dragLast.x;
      const dy = e.clientY - this.dragLast.y;
      this.moveSinceDown += Math.abs(dx) + Math.abs(dy);
      this.look.x += dx * 1.6;
      this.look.y += dy * 1.6;
      this.dragLast = { x: e.clientX, y: e.clientY };
    }
  };

  private readonly onMouseUp = (e: MouseEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    // A click without a drag locks the pointer for mouse-look.
    if (e.button === 0 && this.moveSinceDown < 4) this.requestPointerLock();
  };

  private readonly onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.zoom += clamp(e.deltaY, -120, 120) / 120;
  };

  private readonly onTouchStart = (e: TouchEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.45 && this.stickId === null) {
        this.stickId = t.identifier;
        this.stickOrigin = { x: t.clientX, y: t.clientY };
        this.stickBase.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
        this.stickKnob.style.transform = 'translate(0px, 0px)';
        this.stickBase.classList.add('active');
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  };

  private readonly onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        const max = 56;
        let dx = t.clientX - this.stickOrigin.x;
        let dy = t.clientY - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > max) {
          dx *= max / len;
          dy *= max / len;
        }
        this.stick.x = dx / max;
        this.stick.y = -dy / max;
        this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (t.identifier === this.lookId) {
        this.look.x += (t.clientX - this.lookLast.x) * 2.2;
        this.look.y += (t.clientY - this.lookLast.y) * 2.2;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  };

  private readonly onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.stick.x = 0;
        this.stick.y = 0;
        this.stickBase.classList.remove('active');
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
  };
}
