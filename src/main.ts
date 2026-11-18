import '@fontsource/cinzel/600.css';
import '@fontsource-variable/inter';
import './style.css';
import { start } from './app';
import { Hud } from './ui/hud';

const hud = new Hud();
start(hud).catch((err: unknown) => {
  console.error(err);
  hud.showError(err instanceof Error ? err.message : 'Something went wrong while building the scene.');
});
