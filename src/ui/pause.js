// Table controls next to the help button.
// Pause: any seated player can stop the game (button or P) and anyone seated can resume it.
// While paused, a sign shows who paused and a fact from the rules.
// Speed: each player asks for double speed (button or X); the game runs at x2 once everyone at the table asks.
import { S } from "../state.js";
import { act, nameOfPeer } from "../net/session.js";
import { getView } from "../net/view.js";
import { mySeat } from "../game.js";
import { $, toast } from "./dom.js";

// Keep these true to src/sim/rules.js and src/sim/cards.js when the rules change.
export const FACTS = [
  "Вежа б’є на 15% сильніше за кожного іншого гравця, чия вежа стоїть на одній з 8 сусідніх клітинок. Разом до +60%.",
  "Для синергії діагональні клітинки теж рахуються.",
  "Кілька веж одного гравця поруч дають синергію лише один раз, а ваші власні вежі без карти «Єдність» не рахуються.",
  "Карта «Єдність» дає синергію між вашими вежами різних типів: +15% за кожен інший тип поруч, до +30%.",
  "За вбивство половину нагороди отримує власник вежі, а другу половину порівну ділять усі за столом.",
  "Під час хвилі кристал щосекунди дає кожному 1 золото, доки не набереться половина бонусу за хвилю.",
  "Бонус за пройдену хвилю росте: 20 золота плюс по 4 за кожен номер хвилі.",
  "Кожна п’ята хвиля веде Колоса: 700 здоров’я, а якщо він дійде до кристала, забере 6 життів.",
  "Пішак і Бігун забирають у кристала по 1 життю, Броня 2, а Колос 6.",
  "Мороз сповільнює ворогів удвічі. На третьому рівні холод тримається 2,4 с.",
  "Блискавка Тесли слабшає на чверть з кожним перескоком на наступну ціль.",
  "Вибух Гармати б’є сусідів цілі на 55% від повної шкоди.",
  "Кожен рівень вежі множить шкоду на 1,6, пришвидшує постріли на 12% і додає 0,3 дальності.",
  "Продаж повертає 65% вкладеного, а з картою «Торговець» 80%.",
  "Вежу, поставлену на перерві, можна скасувати й повернути все золото, поки не почалась хвиля.",
  "Вежі завжди цілять у ворога, якому лишилося найменше йти до кристала.",
  "Покращити можна і чужу вежу за своє золото: так команда допомагає одне одному.",
  "Кнопка «+25» біля імені гравця дарує йому 25 золота.",
  "Після кожної третьої хвилі кожен обирає 1 з 3 карт, і в кожного свій вибір.",
  "У руці вміщається 3 карти магії. Четверта витісняє найстарішу.",
  "Хто вилетів, зберігає місце, золото й вежі 3 хвилини. Протягом 10 хвилин гра сама посадить його назад.",
  "Що більше гравців за столом, то більше ворогів у хвилі і тим вони міцніші.",
  "З картою «Дешеві стріли» Стрілець коштує 40 золота замість 50.",
  "Перерва між хвилями триває 20 с, але хвиля почнеться раніше, щойно всі натиснуть «Готовий».",
  "«Землетрус» відкидає всіх ворогів на 1,5 клітинки назад, а «Хуртовина» сповільнює всіх на 4 с.",
  "«Вогняна куля» сильнішає з кожною хвилею, тож у пізніх хвилях вона так само корисна.",
];

let shown = false, factIdx = -1;
function nextFact() {
  let i = Math.floor(Math.random() * FACTS.length);
  if (i === factIdx) i = (i + 1) % FACTS.length;
  factIdx = i;
  $("pauseFact").textContent = FACTS[i];
}

export function togglePause() {
  const v = getView(performance.now());
  if (!v || mySeat(v) < 0 || v.ph > 2) return;
  const pending = [...S.queue].reverse().find(q => q[1] === "p");
  const paused = pending ? !!pending[2] : !!v.pz;
  act("p", paused ? 0 : 1);
  S.uiDirty = true;
}

const wantsFast = (v, seat) => {
  const pending = [...S.queue].reverse().find(q => q[1] === "x");
  return pending ? !!pending[2] : !!(v.fw & (1 << seat));
};
export function toggleSpeed() {
  const v = getView(performance.now()), seat = mySeat(v);
  if (!v || seat < 0 || v.ph > 2) return;
  const want = !wantsFast(v, seat);
  act("x", want ? 1 : 0);
  if (want && v.seats.filter(Boolean).length > 1) toast("Подвійна швидкість увімкнеться, коли всі за столом погодяться");
  S.uiDirty = true;
}
function updateSpeed(v) {
  const b = $("speedBtn"), seat = mySeat(v);
  b.hidden = !v || seat < 0 || v.ph > 2;
  if (b.hidden) return;
  const fast = v.speed, mine = wantsFast(v, seat);
  const n = v.seats.reduce((a, s, i) => a + (s && v.fw & (1 << i) ? 1 : 0), 0), all = v.seats.filter(Boolean).length;
  b.textContent = fast === 2 ? "×2" : "×1";
  b.classList.toggle("on", fast === 2);
  b.classList.toggle("wait", mine && fast !== 2);
  b.title = fast === 2 ? "Подвійна швидкість (X), натисніть, щоб повернути звичайну"
    : mine ? `Ви за подвійну швидкість, чекаємо інших: ${n}/${all} (X)` : `Подвійна швидкість (X)${n ? `: за ${n}/${all}` : ""}`;
}

/** Called by the HUD on every update. */
export function updatePause(v) {
  updateSpeed(v);
  const paused = !!(v && v.pz && v.ph <= 2);
  $("pauseBtn").hidden = !v || mySeat(v) < 0 || v.ph > 2;
  $("pauseBtn").classList.toggle("on", paused);
  if (paused !== shown) {
    shown = paused;
    $("pauseOverlay").hidden = !paused;
    if (paused) nextFact();
  }
  if (paused) {
    const who = v.seats[v.pz - 1];
    $("pauseWho").textContent = who === S.myPeer ? "Ви поставили гру на паузу" : `${nameOfPeer(who)} поставив(-ла) гру на паузу`;
    $("pauseGo").hidden = mySeat(v) < 0;
  }
}

export function initPause() {
  $("pauseBtn").addEventListener("click", togglePause);
  $("speedBtn").addEventListener("click", toggleSpeed);
  $("pauseGo").addEventListener("click", togglePause);
  $("pauseFactNext").addEventListener("click", nextFact);
}
