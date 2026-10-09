const GAME_KEY = "volley-note-game-v1";
const MATCHES_KEY = "volley-note-matches-v2";
const TEAMS_KEY = "volley-note-teams-v1";
const POSITIONS = ["OH", "MB", "OP", "S", "L"];
const LEGACY_POSITIONS = ["OH①", "OH②", "MB①", "MB②", "OP", "S", "L"];
const DEFAULT_ROLES = ["OH", "OH", "MB", "MB", "OP", "S", "L"];
const PLAYS = ["サーブ", "レシーブ", "トス", "スパイク", "ブロック", "ミス"];
const clone = (value) => JSON.parse(JSON.stringify(value));
const $ = (id) => document.getElementById(id);
function createId() { return window.crypto?.randomUUID?.() || `vn-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function freshGame() {
  return {
    id: createId(), matchName: "試合", matchNote: "", teamNames: { A: "Aチーム", B: "Bチーム" },
    teams: Object.fromEntries(["A", "B"].map((team) => [team, LEGACY_POSITIONS.map((slot, index) => ({ id: `${team}-default-${index + 1}`, name: `${slot} 選手`, position: DEFAULT_ROLES[index] }))])),
    scores: { A: 0, B: 0 }, setNo: 1, rallyNo: 1, setScores: [], selected: null, spikePending: null,
    pending: [], rallies: [], events: [], finished: false, finishedAt: null,
  };
}

function readJson(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
  catch (error) { console.warn(`${key}を読み込めませんでした`, error); return fallback; }
}
function normalizePosition(position) {
  const value = String(position || "OH");
  if (value.startsWith("OH")) return "OH";
  if (value.startsWith("MB")) return "MB";
  return POSITIONS.includes(value) ? value : "OH";
}
function normalizeGame(raw = {}) {
  const value = { ...freshGame(), ...raw };
  value.teamNames = { A: "Aチーム", B: "Bチーム", ...(raw.teamNames || {}) };
  value.setScores ||= raw.sets || [];
  value.teams = Object.fromEntries(["A", "B"].map((team) => {
    const roster = raw.teams?.[team] ?? value.teams[team];
    if (Array.isArray(roster)) return [team, roster.map((p, index) => ({ id: p.id || `${team}-migrated-${index}-${Date.now()}`, name: String(p.name || "選手"), position: normalizePosition(p.position) }))];
    return [team, Object.entries(roster || {}).map(([slot, name], index) => ({ id: `${team}-legacy-${index + 1}`, name: String(name), position: normalizePosition(slot) }))];
  }));
  const playerIdFor = (team, position, name) => value.teams[team]?.find((p) => p.position === position && p.name === name)?.id;
  const normalizePlay = (p) => {
    if (!p.player && p.name) p.player = p.name;
    p.position = normalizePosition(p.position);
    if (!p.player_id) p.player_id = playerIdFor(p.team, p.position, p.player);
    return p;
  };
  value.pending = (value.pending || []).map(normalizePlay);
  value.rallies = (value.rallies || []).map((r) => ({ ...r, plays: (r.plays || []).map(normalizePlay) }));
  for (const key of ["selected", "spikePending"]) {
    const player = value[key];
    if (!player) continue;
    player.position = normalizePosition(player.position);
    player.player ||= player.name;
    player.name ||= player.player;
    player.player_id ||= playerIdFor(player.team, player.position, player.name);
  }
  return value;
}
let game = normalizeGame(readJson(GAME_KEY, {}));
game.setScores ||= game.sets || [];
game.rallies ||= [];
game.events ||= [];
game.pending ||= [];
let matches = readJson(MATCHES_KEY, []);
if (!Array.isArray(matches)) matches = [];
let teamTemplates = readJson(TEAMS_KEY, []);
if (!Array.isArray(teamTemplates)) teamTemplates = [];
let offlineReady = false;
let toastTimer;
let confirmAction = null;
let formAction = null;
const confirmDialog = $("confirm-dialog");
const formDialog = $("form-dialog");
const formContent = $("form-content");

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function teamName(team) { return game.teamNames?.[team] || `${team}チーム`; }
function saveGame() {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(game));
    const saved = matches.find((item) => item.id === game.id);
    if (saved) { saved.title = game.matchName || saved.title; saved.game = clone(game); saved.savedAt = new Date().toISOString(); saveMatches(); }
    $("save-state").textContent = "この端末に保存済み";
  }
  catch (error) { $("save-state").textContent = "保存できませんでした"; showToast("端末に保存できませんでした。空き容量を確認してください。"); }
}
function saveMatches() { localStorage.setItem(MATCHES_KEY, JSON.stringify(matches)); }
function saveTeamTemplates() { localStorage.setItem(TEAMS_KEY, JSON.stringify(teamTemplates)); }
function persist(message = "") { saveGame(); render(); if (message) showToast(message); }
function showToast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function showConfirm(title, message, action, buttonLabel = "実行する") {
  $("confirm-title").textContent = title; $("confirm-message").textContent = message;
  $("confirm-accept").textContent = buttonLabel; confirmAction = action; confirmDialog.showModal();
}
confirmDialog.addEventListener("close", () => {
  const action = confirmDialog.returnValue === "confirm" ? confirmAction : null; confirmAction = null; if (action) action();
});
function openForm(title, fields, action, saveLabel = "保存") {
  formContent.innerHTML = `<h2>${esc(title)}</h2>${fields}<div class="dialog-actions"><button class="button button-quiet" type="button" data-close-form>キャンセル</button><button class="button button-primary" type="submit">${esc(saveLabel)}</button></div>`;
  formAction = action; formDialog.showModal();
}
formContent.addEventListener("submit", (event) => {
  event.preventDefault(); const action = formAction; formAction = null; if (action) action(new FormData(formContent)); formDialog.close();
});
formContent.addEventListener("click", (event) => { if (event.target.closest("[data-close-form]")) { formAction = null; formDialog.close(); } });

function playerEntry(team, playerId) {
  const player = game.teams[team].find((p) => p.id === playerId);
  return player ? { team, player_id: player.id, position: player.position, name: player.name } : null;
}
function spikeRecord(player, outcome) { return { team: player.team, player_id: player.player_id, position: player.position, player: player.name, play: "スパイク", outcome }; }
function unresolved(list, play) { return [...list].reverse().find((p) => p.play === play && !p.outcome); }
function resolveRally(winner) {
  if (game.spikePending) {
    const hitter = game.spikePending;
    game.pending.push(spikeRecord(hitter, hitter.team === winner ? "得点" : "ミス"));
    game.spikePending = null;
  }
  game.pending.forEach((play, index) => {
    if (play.play === "レシーブ" && !play.outcome) play.outcome = play.team === winner ? "成功" : "失敗";
    if (play.play === "サーブ" && !play.outcome) {
      const later = game.pending.slice(index + 1);
      const direct = later.every((p) => ["レシーブ", "ミス"].includes(p.play));
      if (play.team === winner && direct) play.outcome = "エース";
      else if (play.team !== winner && later.length === 0) play.outcome = "ミス";
      else play.outcome = "効果";
    }
  });
  const last = game.pending.at(-1);
  if (last?.play === "ブロック") last.outcome = last.team === winner ? "得点" : "継続";
  game.rallies.push({ number: game.rallyNo, set: game.setNo, winner, plays: clone(game.pending) });
  game.scores[winner] += 1; game.pending = []; game.rallyNo += 1; game.selected = null;
}
function selectPlayer(team, playerId) {
  if (game.finished) return;
  const player = playerEntry(team, playerId); if (!player) return;
  if (game.spikePending) { game.pending.push(spikeRecord(game.spikePending, "継続")); game.spikePending = null; }
  if (game.pending.at(-1)?.play === "ブロック") game.pending.at(-1).outcome = "継続";
  game.selected = player; persist();
}
function recordPlay(play) {
  if (game.finished) return;
  const player = game.selected;
  if (play === "ミス") {
    if (game.spikePending && (!player || (player.team === game.spikePending.team && player.position === game.spikePending.position))) {
      const hitter = game.spikePending; game.pending.push(spikeRecord(hitter, "ミス")); game.spikePending = null;
      resolveRally(hitter.team === "A" ? "B" : "A"); persist(`${hitter.name}のスパイクミス。相手チームに得点`); return;
    }
    const target = game.pending.at(-1);
    const samePlayer = player && (target?.player_id && player.player_id ? target.player_id === player.player_id : target?.team === player.team && target?.position === player.position && target?.player === player.name);
    if (target && target.play !== "ミス" && !target.outcome && (!player || samePlayer)) {
      target.outcome = target.play === "レシーブ" ? "失敗" : "ミス";
      const loser = target.team; game.selected = null; resolveRally(loser === "A" ? "B" : "A"); persist(`${target.player}の${target.play}ミス。相手チームに得点`); return;
    }
  }
  if (!player) { showToast("先に選手を選んでください"); return; }
  if (game.spikePending) { game.pending.push(spikeRecord(game.spikePending, "継続")); game.spikePending = null; }
  const reception = unresolved(game.pending, "レシーブ");
  if (reception) reception.outcome = play === "ミス" || player.team !== reception.team ? "失敗" : "成功";
  const serve = unresolved(game.pending, "サーブ");
  if (serve && !["レシーブ", "ミス"].includes(play)) serve.outcome = "効果";
  if (play === "スパイク") { game.spikePending = { ...player }; game.selected = null; persist(); return; }
  game.pending.push({ team: player.team, player_id: player.player_id, position: player.position, player: player.name, play }); game.selected = null;
  if (play === "ミス") {
    const unresolvedServe = unresolved(game.pending, "サーブ");
    if (unresolvedServe && unresolvedServe.team === player.team && !unresolvedServe.outcome) unresolvedServe.outcome = "ミス";
    resolveRally(player.team === "A" ? "B" : "A"); persist(`${player.name}のミス。相手チームに得点`); return;
  }
  persist(`${player.name}の${play}を記録しました`);
}
function awardPoint(winner) { if (game.finished) return; resolveRally(winner); persist(`${teamName(winner)}に得点`); }
function undoPlay() {
  if (game.spikePending) game.spikePending = null;
  else if (game.pending.length) { game.pending.pop(); game.selected = null; }
  else { showToast("取り消せるプレーがありません"); return; }
  persist("直前のプレーを取り消しました");
}
function undoRally() {
  const index = [...game.rallies].map((r, i) => [r, i]).reverse().find(([r]) => r.set === game.setNo)?.[1];
  if (index == null) { showToast("このセットに取り消せるラリーがありません"); return; }
  const [rally] = game.rallies.splice(index, 1); game.scores[rally.winner] = Math.max(0, game.scores[rally.winner] - 1);
  game.pending = clone(rally.plays); game.rallyNo = rally.number; game.selected = null; persist("直前のラリーを取り消しました");
}
function eventRecord(type, team, detail = "") { game.events.push({ set: game.setNo, rally: game.rallyNo, team, type, detail }); }

function openTeamEditor() {
  openForm("チーム名を編集", `<label>Aチーム名</label><input name="teamA" required maxlength="24" value="${esc(game.teamNames.A)}"><label>Bチーム名</label><input name="teamB" required maxlength="24" value="${esc(game.teamNames.B)}">`, (data) => {
    game.teamNames.A = String(data.get("teamA")).trim() || "Aチーム"; game.teamNames.B = String(data.get("teamB")).trim() || "Bチーム"; persist("チーム名を変更しました");
  });
}
function openRosterEditor() {
  const panel = $("roster-management");
  panel.open = true;
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
}
function addPlayer(team) {
  const options = POSITIONS.map((position) => '<option>' + position + '</option>').join("");
  openForm(teamName(team) + "に選手を追加", '<label>選手名</label><input name="name" required maxlength="24" autocomplete="off"><label>ポジション</label><select name="position">' + options + '</select>', (data) => {
    const name = String(data.get("name")).trim();
    if (!name) return;
    game.teams[team].push({ id: createId(), name, position: String(data.get("position")) });
    persist(teamName(team) + "に選手を追加しました");
  });
}
function saveTeamTemplate(team) {
  openForm(teamName(team) + "を保存", '<label>保存名</label><input name="title" required maxlength="40" value="' + esc(teamName(team)) + '">', (data) => {
    const title = String(data.get("title")).trim();
    if (!title) return;
    teamTemplates.push({ id: createId(), title, teamName: teamName(team), players: clone(game.teams[team]) });
    saveTeamTemplates(); renderTeamTemplates(); showToast("チームを保存しました");
  });
}
function loadTeamTemplate(templateId, team) {
  const item = teamTemplates.find((entry) => entry.id === templateId);
  if (!item) return;
  const previous = game.teams[team];
  game.teams[team] = item.players.map((player) => {
    const existing = previous.find((candidate) => candidate.name === player.name && candidate.position === player.position);
    return { ...clone(player), id: existing?.id || createId() };
  });
  game.teamNames[team] = item.teamName || item.title;
  if (game.selected?.team === team) game.selected = null;
  if (game.spikePending?.team === team) game.spikePending = null;
  persist(teamName(team) + "に保存チームを読み込みました");
}
function renderTeamTemplates() {
  const select = (team) => '<select aria-label="保存チーム" id="team-template-' + team + '"><option value="">保存チームを選択</option>' + teamTemplates.map((item) => '<option value="' + esc(item.id) + '">' + esc(item.title) + '</option>').join("") + '</select><button class="button button-quiet" data-action="load-team" data-team="' + team + '">このチームに読み込む</button>';
  $("team-templates").innerHTML = ["A", "B"].map((team) => '<article class="team-card"><h3>' + esc(teamName(team)) + '</h3><button class="button button-primary" data-action="save-team" data-team="' + team + '">現在のチームを保存</button><div class="template-load">' + select(team) + '</div></article>').join("") + (teamTemplates.length ? '<div class="template-list">' + [...teamTemplates].reverse().map((item) => '<div><span>' + esc(item.title) + ' · ' + esc(item.players.length) + '人</span><button class="button button-error" data-action="delete-team-template" data-id="' + esc(item.id) + '">削除</button></div>').join("") + '</div>' : '<p class="empty-feed">保存したチームはありません。</p>');
}
function openMatchSettings() {
  openForm("試合情報", `<label>試合名</label><input name="matchName" maxlength="60" value="${esc(game.matchName)}"><label>試合メモ</label><textarea name="matchNote" rows="5" maxlength="1500">${esc(game.matchNote)}</textarea>`, (data) => {
    game.matchName = String(data.get("matchName")).trim() || "試合"; game.matchNote = String(data.get("matchNote")).trim(); persist("試合情報を保存しました");
  });
}
function openSubstitution() {
  const outgoing = ["A", "B"].flatMap((team) => game.teams[team].map((p) => '<option value="' + team + '|' + p.id + '">' + esc(teamName(team)) + " · " + esc(p.position) + " " + esc(p.name) + "</option>")).join("");
  const positions = POSITIONS.map((p) => "<option>" + p + "</option>").join("");
  const fields = '<label>交代する選手</label><select name="outgoing">' + outgoing + '</select><label>入る選手</label><input name="name" required maxlength="24" autocomplete="off"><label>ポジション</label><select name="position">' + positions + "</select>";
  openForm("選手交代", fields, (data) => {
    const [team, outgoingId] = String(data.get("outgoing")).split("|");
    const outgoingPlayer = game.teams[team].find((p) => p.id === outgoingId);
    const name = String(data.get("name")).trim();
    if (!name || !outgoingPlayer) return;
    game.teams[team] = game.teams[team].filter((p) => p.id !== outgoingId);
    const position = data.get("position");
    game.teams[team].push({ id: createId(), name, position });
    eventRecord("選手交代", team, outgoingPlayer.position + " " + outgoingPlayer.name + " → " + position + " " + name);
    persist(teamName(team) + "の選手を交代しました");
  });
}
function endSet(winner) {
  game.setScores.push({ set: game.setNo, A: game.scores.A, B: game.scores.B, winner });
  eventRecord("セット終了", winner, `${teamName("A")} ${game.scores.A} - ${game.scores.B} ${teamName("B")}`);
  game.setNo += 1; game.scores = { A: 0, B: 0 }; game.rallyNo = 1; game.pending = []; game.selected = null; game.spikePending = null; persist(`${teamName(winner)}がセットを獲得しました`);
}
function openSetEnd() {
  openForm("セット終了", `<label>セットを取ったチーム</label><select name="winner"><option value="A">${esc(teamName("A"))}</option><option value="B">${esc(teamName("B"))}</option></select>`, (data) => endSet(data.get("winner")), "セットを終了");
}

function hasData() {
  const defaults = freshGame().teams;
  const rosterChanged = ["A", "B"].some((team) => JSON.stringify(game.teams[team].map((p) => [p.name, p.position])) !== JSON.stringify(defaults[team].map((p) => [p.name, p.position])));
  return game.rallies.length || game.pending.length || game.events.length || game.matchNote || game.finished || game.scores.A || game.scores.B || game.teamNames.A !== "Aチーム" || game.teamNames.B !== "Bチーム" || rosterChanged;
}
function archiveCurrent() {
  const item = { id: game.id || createId(), title: game.matchName || `${teamName("A")} vs ${teamName("B")}`, savedAt: new Date().toISOString(), game: clone(game) };
  item.game.id = item.id; matches = matches.filter((m) => m.id !== item.id); matches.push(item); game.id = item.id; saveMatches(); saveGame(); render(); return item;
}
function finishMatch() {
  if (game.spikePending) { game.pending.push(spikeRecord(game.spikePending, "未確定")); game.spikePending = null; }
  game.finished = true; game.finishedAt = new Date().toISOString(); const item = archiveCurrent(); showToast(`試合を終了して「${item.title}」を保存しました`);
}
function startNewMatch() {
  if (hasData()) archiveCurrent(); game = freshGame(); persist("新しい試合を始めました");
}
function openSavedMatch(id) {
  let item = matches.find((m) => m.id === id); if (!item) return;
  if (hasData()) { archiveCurrent(); item = matches.find((m) => m.id === id) || item; }
  game = normalizeGame({ ...clone(item.game), id: item.id }); persist(`「${item.title}」を開きました`); window.scrollTo({ top: 0, behavior: "smooth" });
}
function deleteSavedMatch(id) { matches = matches.filter((m) => m.id !== id); saveMatches(); renderArchive(); showToast("保存した試合を削除しました"); }

function renderLineups() {
  $("lineups").innerHTML = ["A", "B"].map((team) => {
    const buttons = game.teams[team].map((player) => {
      const active = game.selected?.player_id === player.id;
      return '<button class="player-choice ' + (active ? "selected" : "") + '" data-action="select" data-team="' + team + '" data-player-id="' + esc(player.id) + '" ' + (game.finished ? "disabled" : "") + '><span class="position">' + esc(player.position) + '</span><span class="player-name">' + esc(player.name) + "</span></button>";
    }).join("");
    return '<article class="team-card" data-team="' + team + '"><h3>' + esc(teamName(team)) + '</h3><div class="player-grid">' + buttons + "</div></article>";
  }).join("");
  $("score-a").textContent = game.scores.A; $("score-b").textContent = game.scores.B; $("set-no").textContent = game.setNo; $("rally-no").textContent = String(game.rallyNo).padStart(3, "0");
  $("team-label-a").textContent = teamName("A"); $("team-label-b").textContent = teamName("B");
}
function renderRosterEditor() {
  $("roster-editor").innerHTML = ["A", "B"].map((team) => {
    const rows = game.teams[team].map((player) => {
      const options = POSITIONS.map((position) => '<option ' + (position === player.position ? "selected" : "") + ">" + position + "</option>").join("");
      return '<form class="roster-row" data-player-edit-form data-team="' + team + '" data-player-id="' + esc(player.id) + '"><input name="name" aria-label="選手名" value="' + esc(player.name) + '" maxlength="24" required><select name="position" aria-label="ポジション">' + options + '</select><button class="button button-quiet" type="submit">保存</button><button class="button button-error" type="button" data-action="remove-player" data-team="' + team + '" data-player-id="' + esc(player.id) + '">削除</button></form>';
    }).join("");
    return '<article class="team-card"><h3>' + esc(teamName(team)) + '</h3>' + rows + '<button class="button button-primary" data-action="add-player" data-team="' + team + '">＋ 選手を追加</button></article>';
  }).join("");
}
function renderRally() {
  $("current-selection").textContent = game.spikePending ? `${game.spikePending.name} · スパイク後の処理を選択` : game.selected ? `選択中：${teamName(game.selected.team)} · ${game.selected.position} ${game.selected.name}` : "選手を選択してください";
  $("play-buttons").innerHTML = PLAYS.map((play) => `<button class="button button-play" data-action="play" data-play="${play}" ${game.finished || (!game.selected && play !== "ミス") ? "disabled" : ""}>${play}</button>`).join("");
  const outcomeBox = $("spike-result"); outcomeBox.hidden = !game.spikePending;
  outcomeBox.textContent = game.spikePending ? `${game.spikePending.name}のスパイクを記録中。次のプレーか得点が記録されると結果を自動で判断します。` : "";
  $("rally-feed").innerHTML = game.pending.length ? game.pending.map((play, i) => `<div class="play-event"><span class="event-number">${String(i + 1).padStart(2, "0")}</span><span class="event-team">${esc(teamName(play.team))} · ${esc(play.position)} ${esc(play.player)}</span><span>${esc(play.play)}${play.outcome ? `（${esc(play.outcome)}）` : ""}</span></div>`).join("") : '<div class="empty-feed">このラリーのプレーはまだ記録されていません。</div>';
  document.querySelector('[data-action="undo-play"]').disabled = game.finished || (!game.pending.length && !game.spikePending);
  document.querySelectorAll('[data-action="award"]').forEach((b) => { b.disabled = game.finished; b.textContent = `${teamName(b.dataset.team)}に得点`; });
  document.querySelectorAll('[data-action="timeout"]').forEach((b) => { b.disabled = game.finished; b.textContent = `⏱ ${teamName(b.dataset.team)} タイムアウト`; });
  document.querySelectorAll(".operation").forEach((b) => { if (!["new-match", "match-info", "team-names", "roster"].includes(b.dataset.action)) b.disabled = game.finished; });
  $("match-name-display").textContent = game.matchName || "試合";
  $("match-note-display").textContent = game.matchNote || "試合メモはまだありません。";
  $("finished-state").textContent = game.finished ? "試合終了" : "試合中";
}
function allPlays(g = game) { return [...(g.rallies || []).flatMap((r) => r.plays || []), ...(g.pending || [])]; }
function renderStats(target = "stats-body", g = game) {
  const plays = allPlays(g), names = g.teamNames || { A: "Aチーム", B: "Bチーム" }, athletes = new Map();
  ["A", "B"].forEach((team) => g.teams[team].forEach((player) => athletes.set(player.id, { id: player.id, team, position: player.position, name: player.name })));
  plays.filter((p) => ["スパイク", "サーブ", "レシーブ", "ブロック"].includes(p.play)).forEach((p) => {
    const id = p.player_id || (p.team + "|" + p.position + "|" + p.player);
    if (!athletes.has(id)) athletes.set(id, { id, team: p.team, position: p.position, name: p.player });
  });
  const rows = [...athletes.values()].sort((a, b) => a.team.localeCompare(b.team) || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
  $(target).innerHTML = rows.map((a) => {
    const mine = plays.filter((p) => p.player_id ? p.player_id === a.id : p.team === a.team && p.position === a.position && p.player === a.name);
    const attacks = mine.filter((p) => p.play === "スパイク" && ["得点", "継続", "ミス"].includes(p.outcome));
    const kills = attacks.filter((p) => p.outcome === "得点").length, errors = attacks.filter((p) => p.outcome === "ミス").length;
    const serves = mine.filter((p) => p.play === "サーブ" && ["エース", "効果", "ミス"].includes(p.outcome));
    const serveRate = serves.length ? serves.reduce((n, p) => n + ({ エース: 100, 効果: 25, ミス: -25 }[p.outcome] || 0), 0) / serves.length : null;
    const rec = mine.filter((p) => p.play === "レシーブ" && ["成功", "失敗"].includes(p.outcome));
    const blocks = mine.filter((p) => p.play === "ブロック" && p.outcome === "得点").length;
    const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : "—";
    return `<tr><td>${esc(names[a.team] || `${a.team}チーム`)}</td><td>${esc(a.position)} ${esc(a.name)}</td><td>${attacks.length}</td><td>${kills}</td><td>${errors}</td><td>${pct(kills, attacks.length)}</td><td>${pct(kills - errors, attacks.length)}</td><td>${serveRate == null ? "—" : `${serveRate.toFixed(1)}%`}</td><td>${blocks}</td><td>${pct(rec.filter((p) => p.outcome === "成功").length, rec.length)}</td></tr>`;
  }).join("");
}
function renderHistory() {
  const rows = [
    ...game.rallies.map((r) => `<div class="history-row"><div class="history-meta">第${r.set}セット · Rally ${String(r.number).padStart(3, "0")} · ${esc(teamName(r.winner))}に得点</div><div>${(r.plays || []).map((p) => `${esc(teamName(p.team))} ${esc(p.position)} ${esc(p.player)} ${esc(p.play)}${p.outcome ? `（${esc(p.outcome)}）` : ""}`).join(" → ") || "プレー記録なし"}</div></div>`),
    ...game.events.map((e) => `<div class="history-row"><div class="history-meta">第${e.set}セット · Rally ${String(e.rally).padStart(3, "0")} · ${esc(teamName(e.team))} · ${esc(e.type)}</div><div>${esc(e.detail)}</div></div>`),
  ];
  $("history-count").textContent = rows.length; $("history-list").innerHTML = rows.length ? rows.reverse().join("") : '<div class="history-row">まだ記録はありません。</div>';
}
function renderArchive() {
  $("saved-count").textContent = matches.length;
  $("saved-matches").innerHTML = matches.length ? [...matches].reverse().map((item) => {
    const m = item.game, score = `${m.teamNames?.A || "Aチーム"} ${m.scores?.A || 0} - ${m.scores?.B || 0} ${m.teamNames?.B || "Bチーム"}`;
    const date = item.savedAt ? new Date(item.savedAt).toLocaleString("ja-JP") : "";
    const sets = (m.setScores || m.sets || []).map((s) => `第${s.set || s["セット"]}セット ${s.A}-${s.B}`).join(" · ");
    return `<article class="saved-match"><div><strong>${esc(item.title)}</strong><small>${esc(date)} · ${esc(score)}${sets ? ` · ${esc(sets)}` : ""}${m.finished ? " · 試合終了" : ""}</small></div><div class="saved-actions"><button class="button button-quiet" data-action="open-match" data-id="${esc(item.id)}">開く</button><button class="button button-error" data-action="delete-match" data-id="${esc(item.id)}">削除</button></div><details><summary>成績・メモ</summary>${m.matchNote ? `<p>${esc(m.matchNote)}</p>` : ""}<div class="table-scroll"><table><thead><tr><th>チーム</th><th>選手</th><th>試行</th><th>得点</th><th>ミス</th><th>決定率</th><th>攻撃効率</th><th>サーブ効果率</th><th>ブロック</th><th>返球率</th></tr></thead><tbody id="stats-${esc(item.id)}"></tbody></table></div></details></article>`;
  }).join("") : '<p class="empty-feed">保存した試合はありません。</p>';
  matches.forEach((item) => { const id = `stats-${item.id}`; if ($(id)) renderStats(id, item.game); });
}
function render() {
  renderLineups(); renderRosterEditor(); renderTeamTemplates(); renderRally(); renderStats(); renderHistory(); renderArchive();
  $("network-label").textContent = offlineReady ? (navigator.onLine ? "オフライン利用の準備OK" : "オフライン · 端末に保存") : "オフライン利用を準備中";
}

document.addEventListener("click", (event) => {
  const b = event.target.closest("button[data-action]"); if (!b || b.disabled) return;
  const { action } = b.dataset;
  if (action === "select") selectPlayer(b.dataset.team, b.dataset.playerId);
  else if (action === "play") recordPlay(b.dataset.play);
  else if (action === "undo-play") undoPlay();
  else if (action === "undo-rally") showConfirm("1ラリー戻す", "直前のラリーと得点を取り消しますか？", undoRally, "取り消す");
  else if (action === "award") awardPoint(b.dataset.team);
  else if (action === "timeout") { eventRecord("タイムアウト", b.dataset.team); persist(`${teamName(b.dataset.team)}のタイムアウトを記録しました`); }
  else if (action === "substitution") openSubstitution();
  else if (action === "end-set") openSetEnd();
  else if (action === "edit-roster") openRosterEditor();
  else if (action === "add-player") addPlayer(b.dataset.team);
  else if (action === "remove-player") showConfirm("選手を削除", "この選手を名簿から削除しますか？過去の記録は残ります。", () => {
    const { team, playerId } = b.dataset;
    game.teams[team] = game.teams[team].filter((p) => p.id !== playerId);
    if (game.selected?.player_id === playerId) game.selected = null;
    if (game.spikePending?.player_id === playerId) game.spikePending = null;
    persist("選手を削除しました");
  }, "削除");
  else if (action === "save-team") saveTeamTemplate(b.dataset.team);
  else if (action === "load-team") {
    const select = $("team-template-" + b.dataset.team);
    if (select?.value) showConfirm("保存チームを読み込む", teamName(b.dataset.team) + "の現在の名簿を保存したチームで置き換えます。過去のプレー記録は残ります。", () => loadTeamTemplate(select.value, b.dataset.team), "読み込む");
    else showToast("読み込む保存チームを選んでください");
  }
  else if (action === "delete-team-template") showConfirm("保存チームを削除", "「" + (teamTemplates.find((item) => item.id === b.dataset.id)?.title || "") + "」を削除しますか？", () => { teamTemplates = teamTemplates.filter((item) => item.id !== b.dataset.id); saveTeamTemplates(); renderTeamTemplates(); showToast("保存チームを削除しました"); }, "削除");
  else if (action === "team-names") openTeamEditor();
  else if (action === "match-info") openMatchSettings();
  else if (action === "finish-match") showConfirm("試合を終了", "試合を終了して、この端末の保存試合に追加しますか？", finishMatch, "試合を終了");
  else if (action === "save-match") { const item = archiveCurrent(); showToast(`「${item.title}」を保存しました`); }
  else if (action === "new-match") showConfirm("新しい試合", "現在の試合に記録があれば保存して、新しい試合を始めますか？", startNewMatch, "新しい試合");
  else if (action === "open-match") showConfirm("保存した試合を開く", "今の試合に記録があれば保存してから切り替えます。", () => openSavedMatch(b.dataset.id), "開く");
  else if (action === "delete-match") showConfirm("保存試合を削除", "この試合の保存データを削除します。この操作は元に戻せません。", () => deleteSavedMatch(b.dataset.id), "削除");
  else if (action === "reset") showConfirm("試合をリセット", "現在の試合を消去して初期状態に戻します。必要な場合は先に保存してください。", () => { game = freshGame(); persist("新しい試合を始めました"); }, "リセット");
  else if (action === "export") exportGame();
  else if (action === "edit-rally") openRallyEditor();
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-player-edit-form]");
  if (!form) return;
  event.preventDefault();
  const { team, playerId } = form.dataset;
  const player = game.teams[team].find((p) => p.id === playerId);
  if (!player) return;
  const data = new FormData(form), name = String(data.get("name")).trim();
  if (!name) return;
  player.name = name;
  player.position = String(data.get("position"));
  for (const key of ["selected", "spikePending"]) {
    if (game[key]?.player_id === playerId) { game[key].name = name; game[key].player = name; game[key].position = player.position; }
  }
  persist("選手情報を保存しました");
});

function exportGame() {
  const blob = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `volley-note-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
}
function rallyEditFields(index, selectedPlayIndex = 0) {
  const rally = game.rallies[index], first = rally.plays?.[selectedPlayIndex];
  const rallyOptions = game.rallies.map((r, i) => `<option value="${i}" ${i === index ? "selected" : ""}>第${r.set}セット · Rally ${String(r.number).padStart(3, "0")}</option>`).join("");
  const winnerOptions = ["A", "B"].map((team) => `<option value="${team}" ${rally.winner === team ? "selected" : ""}>${esc(teamName(team))}</option>`).join("");
  let playFields = '<p>このラリーに選手プレーの記録はありません。</p>';
  if (first) {
    const playOptions = rally.plays.map((p, i) => `<option value="${i}" ${i === selectedPlayIndex ? "selected" : ""}>${i + 1}. ${esc(teamName(p.team))} · ${esc(p.position)} ${esc(p.player || p.name)} · ${esc(p.play)}</option>`).join("");
    const positionOptions = [...new Set([...POSITIONS, first.position])].map((p) => `<option ${p === first.position ? "selected" : ""}>${esc(p)}</option>`).join("");
    const actionOptions = [...new Set([...PLAYS, first.play])].map((p) => `<option ${p === first.play ? "selected" : ""}>${esc(p)}</option>`).join("");
    const outcomes = ["なし", "得点", "ミス", "継続", "成功", "失敗", "エース", "効果", "未確定"];
    const outcomeOptions = outcomes.map((o) => `<option value="${o}" ${(first.outcome || "なし") === o ? "selected" : ""}>${o}</option>`).join("");
    playFields = `<label>修正するプレー</label><select name="playIndex">${playOptions}</select><div class="edit-fields"><label>プレーしたチーム<select name="playTeam">${["A", "B"].map((t) => `<option value="${t}" ${first.team === t ? "selected" : ""}>${esc(teamName(t))}</option>`).join("")}</select></label><label>ポジション<select name="position">${positionOptions}</select></label></div><label>選手名</label><input name="player" maxlength="24" value="${esc(first.player || first.name)}"><label>プレー</label><select name="play">${actionOptions}</select><label>結果</label><select name="outcome">${outcomeOptions}</select><label class="check-label"><input type="checkbox" name="removePlay">このプレーを削除</label>`;
  }
  return `<div id="rally-edit-fields"><label>修正するラリー</label><select name="index" data-edit-rally-select>${rallyOptions}</select><label>得点チーム</label><select name="winner">${winnerOptions}</select>${playFields}</div>`;
}
formContent.addEventListener("change", (event) => {
  if (event.target.matches("[data-edit-rally-select]")) {
    const wrapper = $("rally-edit-fields"); if (wrapper) wrapper.outerHTML = rallyEditFields(Number(event.target.value));
  } else if (event.target.name === "playIndex") {
    const indexEl = formContent.querySelector("[data-edit-rally-select]");
    const wrapper = $("rally-edit-fields");
    if (wrapper && indexEl) wrapper.outerHTML = rallyEditFields(Number(indexEl.value), Number(event.target.value));
  }
});
function recalculateRally(rally) {
  const plays = rally.plays || [];
  plays.forEach((p, i) => {
    if (p.play === "サーブ" && p.outcome !== "ミス") {
      const later = plays.slice(i + 1), direct = later.every((x) => ["レシーブ", "ミス"].includes(x.play));
      p.outcome = p.team === rally.winner && direct ? "エース" : p.team !== rally.winner && !later.length ? "ミス" : "効果";
    }
    if (p.play === "レシーブ" && !p.error) p.outcome = p.team === rally.winner ? "成功" : "失敗";
  });
  const last = plays.at(-1);
  if (last?.play === "スパイク") last.outcome = last.team === rally.winner ? "得点" : "ミス";
  if (last?.play === "ブロック") last.outcome = last.team === rally.winner ? "得点" : "継続";
}
function openRallyEditor() {
  if (!game.rallies.length) { showToast("修正できるラリーがありません"); return; }
  openForm("ラリー・プレーを修正", rallyEditFields(game.rallies.length - 1), (data) => {
    const rally = game.rallies[Number(data.get("index"))], oldWinner = rally.winner; rally.winner = data.get("winner");
    const playIndex = Number(data.get("playIndex"));
    if (rally.plays?.length && !data.has("removePlay")) {
      const p = rally.plays[playIndex];
      const oldPlay = p.play; p.team = data.get("playTeam"); p.position = data.get("position"); p.player = String(data.get("player")).trim() || p.player || p.name; p.play = data.get("play");
      const outcome = data.get("outcome"); if (outcome === "なし") delete p.outcome; else p.outcome = outcome;
      if (p.play === "ミス") { p.outcome = "ミス"; if (rally.winner === p.team) rally.winner = p.team === "A" ? "B" : "A"; }
      if (p.play === "レシーブ" && outcome === "失敗") p.error = "ミス"; else if (oldPlay === "レシーブ" || p.play !== "レシーブ") delete p.error;
    } else if (rally.plays?.length && data.has("removePlay")) rally.plays.splice(playIndex, 1);
    if (oldWinner !== rally.winner) recalculateRally(rally);
    for (const set of game.setScores) {
      const rows = game.rallies.filter((r) => r.set === set.set); set.A = rows.filter((r) => r.winner === "A").length; set.B = rows.filter((r) => r.winner === "B").length;
      if (set.A !== set.B) set.winner = set.A > set.B ? "A" : "B";
    }
    game.scores = { A: game.rallies.filter((r) => r.set === game.setNo && r.winner === "A").length, B: game.rallies.filter((r) => r.set === game.setNo && r.winner === "B").length };
    persist("ラリー記録を修正し、スコアと選手成績を更新しました");
  });
}

window.addEventListener("online", render); window.addEventListener("offline", render);
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready).then(() => { offlineReady = true; render(); }).catch((error) => console.error("オフライン機能の準備に失敗しました", error)));
}
render();
