import type { Action } from '../input';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export class Hud {
  readonly stick = el('stick');
  readonly stickKnob = el('stick-knob');
  private readonly root = el('hud');
  private readonly loading = el('loading');
  private readonly bar = el('progress-bar');
  private readonly label = el('progress-label');
  private readonly enter = el<HTMLButtonElement>('enter');
  private readonly prompt = el('prompt');
  private readonly promptKey = el('prompt-key');
  private readonly promptText = el('prompt-text');
  private readonly toastEl = el('toast');
  private readonly hints = el('hints');
  private readonly hintsTitle = el('hints-title');
  private readonly hintsAction = el('hints-action');
  private readonly viewChip = el('status-view');
  private readonly seatsChip = el('status-seats');
  private readonly crosshair = el('crosshair');
  private readonly lockHint = el('lock-hint');
  private toastTimer = 0;
  private promptValue = '';

  constructor() {
    const touch = matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('touch', touch);
    this.promptKey.textContent = touch ? 'Tap' : 'E';
  }

  setProgress(fraction: number, text: string): void {
    this.bar.style.transform = `scaleX(${Math.max(0.02, Math.min(1, fraction))})`;
    this.label.textContent = text;
  }

  ready(onEnter: () => void): void {
    this.loading.classList.add('ready');
    this.label.textContent = 'The chamber is ready.';
    this.enter.hidden = false;
    this.enter.focus({ preventScroll: true });
    const go = () => {
      this.enter.removeEventListener('click', go);
      this.loading.classList.add('leaving');
      window.setTimeout(() => (this.loading.hidden = true), 700);
      this.root.hidden = false;
      onEnter();
    };
    this.enter.addEventListener('click', go);
  }

  showError(message: string): void {
    this.loading.hidden = true;
    this.root.hidden = true;
    el('error-message').textContent = message;
    el('error').hidden = false;
    el('retry').addEventListener('click', () => location.reload(), { once: true });
  }

  bindButtons(trigger: (action: Action) => void): void {
    for (const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-action]'))) {
      const action = button.dataset.action as Action;
      button.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        trigger(action);
      }, { passive: false });
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        trigger(action);
      });
    }
    this.prompt.addEventListener('click', () => trigger('sit'));
  }

  setPrompt(text: string | null): void {
    const value = text ?? '';
    if (value === this.promptValue) return;
    this.promptValue = value;
    if (text) this.promptText.textContent = text;
    this.prompt.classList.toggle('visible', !!text);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), 1800);
  }

  setView(first: boolean): void {
    this.viewChip.textContent = first ? 'First person' : 'Third person';
  }

  setSeats(occupied: boolean): void {
    this.seatsChip.textContent = occupied ? 'Mannequins seated' : 'Seats empty';
    this.seatsChip.classList.toggle('on', occupied);
  }

  toggleHints(): void {
    const collapsed = this.hints.classList.toggle('collapsed');
    this.hintsAction.textContent = collapsed ? 'show' : 'hide';
    this.hintsTitle.setAttribute('aria-expanded', String(!collapsed));
  }

  setCrosshair(visible: boolean): void {
    this.crosshair.classList.toggle('visible', visible);
  }

  setPointerLocked(locked: boolean): void {
    this.lockHint.classList.toggle('visible', !locked);
  }
}
