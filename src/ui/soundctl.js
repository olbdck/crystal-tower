// The speaker button: volume slider and mute, remembered in this browser.
import { getVolume, setVolume, unlockAudio, playSound } from "../audio/sound.js";
import { $ } from "./dom.js";

function show() {
  const { volume, muted } = getVolume();
  $("volRange").value = String(Math.round(volume * 100));
  $("muteChk").checked = muted;
  $("soundBtn").classList.toggle("muted", muted || volume === 0);
}

export function initSoundControl() {
  show();
  const pop = $("soundPop"), btn = $("soundBtn");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", e => {
    e.stopPropagation();
    unlockAudio();
    pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden));
  });
  pop.addEventListener("click", e => e.stopPropagation());
  document.addEventListener("click", close);
  $("volRange").addEventListener("input", () => { setVolume(+$("volRange").value / 100, false); show(); playSound("click"); });
  $("muteChk").addEventListener("change", () => { setVolume(undefined, $("muteChk").checked); show(); });
}
